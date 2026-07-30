import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  PencilBrush,
  Point,
  Rect,
  filters,
  iMatrix,
} from 'fabric';
import type { ImageDimensions } from '../lib/imageMetadata';
import {
  assertRestorableEditorSnapshot,
  imageDimensionsMatchHeader,
  inspectEmbeddedImageDataUrl,
} from './snapshotValidation';

export type EditorTool = 'select' | 'brush' | 'eraser' | 'pan';

export type EditorStatusKind = 'info' | 'success' | 'warning' | 'error';

export type EditorChangeReason =
  | 'object-added'
  | 'object-removed'
  | 'object-modified'
  | 'text-changed'
  | 'layer'
  | 'layer-opacity'
  | 'canvas-size'
  | 'clear'
  | 'crop'
  | 'filter'
  | 'duplicate'
  | 'cut'
  | 'paste';

export type ExportImageFormat = 'png' | 'jpeg' | 'webp';

export interface EditorStatus {
  message: string;
  kind: EditorStatusKind;
}

export interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: GlobalCompositeOperation;
  selected: boolean;
}

export interface EditorSnapshot {
  json: Record<string, unknown>;
  width: number;
  height: number;
}

export interface ImageFilterSettings {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  blur?: number;
  grayscale?: boolean;
}

export interface BrushOptions {
  color?: string;
  size?: number;
  opacity?: number;
}

export interface SelectionTransform {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  flipX: boolean;
  flipY: boolean;
}

export interface SelectionTransformUpdate {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  angle?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface AddShapeOptions {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  name?: string;
}

export interface AddTextOptions {
  left?: number;
  top?: number;
  fill?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  name?: string;
}

export interface FabricEditorCallbacks {
  /**
   * Fired only for document mutations. Viewport changes and restore operations
   * intentionally do not fire this callback, so history managers do not create
   * entries for zooming, panning, undo, or redo.
   */
  onChanged?: (reason: EditorChangeReason) => void;
  onSelectionChanged?: (selectedIds: string[]) => void;
  onLayersChanged?: (layers: LayerInfo[]) => void;
  onStatus?: (status: EditorStatus) => void;
  onZoomChanged?: (zoom: number) => void;
}

export interface FabricEditorOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  brushColor?: string;
  brushWidth?: number;
  brushOpacity?: number;
  callbacks?: FabricEditorCallbacks;
}

type EditorObject = FabricObject & {
  editorId?: string;
  editorName?: string;
  editorLocked?: boolean;
};

type ClipboardObject = EditorObject;

const SERIALIZED_EDITOR_PROPERTIES = [
  'editorId',
  'editorName',
  'editorLocked',
] as const;

const MIN_DOCUMENT_SIZE = 1;
const MAX_DOCUMENT_SIZE = 8_192;
const MIN_ZOOM = 0.05;
const MIN_FIT_ZOOM = 0.005;
const MAX_ZOOM = 32;
const DEFAULT_WIDTH = 1_280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_BRUSH_COLOR = '#111827';
const DEFAULT_BRUSH_SIZE = 12;
const DEFAULT_BACKGROUND = 'transparent';
const EPSILON = 0.000_001;
const MAX_IMPORTED_IMAGE_EDGE = 8_192;
const MAX_IMPORTED_IMAGE_PIXELS = 64 * 1_024 * 1_024;
const SAFE_IMAGE_DATA_URL =
  /^data:image\/(?:png|jpeg|webp)(?:;charset=[^;,]+)?;base64,/i;

let fallbackIdCounter = 0;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const documentDimension = (value: number): number =>
  clamp(Math.round(value), MIN_DOCUMENT_SIZE, MAX_DOCUMENT_SIZE);

const createEditorId = (): string => {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  fallbackIdCounter += 1;
  return `layer-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
};

const isAbortLikeError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

const assertSafeImageDimensions = (
  dimensions: ImageDimensions,
): ImageDimensions => {
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_IMPORTED_IMAGE_EDGE ||
    dimensions.height > MAX_IMPORTED_IMAGE_EDGE ||
    dimensions.width * dimensions.height > MAX_IMPORTED_IMAGE_PIXELS
  ) {
    throw new RangeError(
      'Image dimensions exceed the 8,192 px / 64 MP safety limit.',
    );
  }
  return dimensions;
};

/**
 * A React-independent adapter around Fabric.js.
 *
 * Logical document pixels are tracked independently from the Fabric display
 * surface. `fitToViewport` sizes that surface while `setCanvasSize` changes
 * only the document. Zoom and pan are viewport-only operations and are
 * excluded from snapshots and change events.
 */
export class FabricEditorEngine {
  private readonly canvas: Canvas;
  private documentWidth: number;
  private documentHeight: number;
  private callbacks: FabricEditorCallbacks;
  private currentTool: EditorTool = 'select';
  private brushColor: string;
  private brushSize: number;
  private brushOpacity: number;
  private eventSuppressionDepth = 0;
  private disposed = false;
  private isPanning = false;
  private lastPanPoint: Point | null = null;
  private clipboard: ClipboardObject[] = [];
  private pasteGeneration = 0;
  private restoreQueue: Promise<void> = Promise.resolve();
  private isExporting = false;
  private readonly eventDisposers: VoidFunction[] = [];

  public constructor(
    element: HTMLCanvasElement,
    options: FabricEditorOptions = {},
  ) {
    const width = documentDimension(
      finiteOr(options.width, DEFAULT_WIDTH),
    );
    const height = documentDimension(
      finiteOr(options.height, DEFAULT_HEIGHT),
    );

    this.callbacks = options.callbacks ?? {};
    this.documentWidth = width;
    this.documentHeight = height;
    this.brushColor = options.brushColor ?? DEFAULT_BRUSH_COLOR;
    this.brushSize = clamp(
      finiteOr(options.brushWidth, DEFAULT_BRUSH_SIZE),
      1,
      512,
    );
    this.brushOpacity = clamp(
      finiteOr(options.brushOpacity, 1),
      0.01,
      1,
    );

    this.canvas = new Canvas(element, {
      width,
      height,
      backgroundColor: options.backgroundColor ?? DEFAULT_BACKGROUND,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      controlsAboveOverlay: true,
    });
    this.setDocumentClip();
    this.canvas.freeDrawingBrush = new PencilBrush(this.canvas);
    this.applyBrushOptions();
    this.bindEvents();
    this.configureObjectInteractivity();
    this.emitLayers();
    this.emitSelection();
    this.emitZoom();
  }

  public getCanvas(): Canvas {
    return this.canvas;
  }

  public setCallbacks(callbacks: FabricEditorCallbacks): void {
    this.callbacks = callbacks;
    this.emitLayers();
    this.emitSelection();
    this.emitZoom();
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    await this.restoreQueue.catch(() => undefined);
    this.eventDisposers.splice(0).forEach((dispose) => dispose());
    this.clipboard = [];
    await this.canvas.dispose();
  }

  public getTool(): EditorTool {
    return this.currentTool;
  }

  public setTool(tool: EditorTool, brushOptions?: BrushOptions): void {
    this.assertUsable();
    this.currentTool = tool;
    if (brushOptions) {
      this.setBrushOptions(brushOptions);
    }

    this.isPanning = false;
    this.lastPanPoint = null;
    this.canvas.isDrawingMode = tool === 'brush' || tool === 'eraser';
    this.canvas.selection = tool === 'select';
    this.canvas.skipTargetFind = tool !== 'select';
    this.canvas.defaultCursor = tool === 'pan' ? 'grab' : 'default';
    this.canvas.hoverCursor = tool === 'pan' ? 'grab' : 'move';
    this.canvas.freeDrawingCursor =
      tool === 'eraser' ? 'cell' : 'crosshair';
    this.withSuppressedEvents(() => {
      this.configureObjectInteractivity();
      this.applyBrushOptions();
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
    });
    this.emitSelection();
    this.emitLayers();
  }

  public setBrushOptions(options: BrushOptions): void {
    this.assertUsable();
    if (typeof options.color === 'string' && options.color.trim()) {
      this.brushColor = options.color;
    }
    if (typeof options.size === 'number' && Number.isFinite(options.size)) {
      this.brushSize = clamp(options.size, 1, 512);
    }
    if (
      typeof options.opacity === 'number' &&
      Number.isFinite(options.opacity)
    ) {
      this.brushOpacity = clamp(options.opacity, 0.01, 1);
    }
    this.applyBrushOptions();
  }

  public getBrushOptions(): Required<BrushOptions> {
    return {
      color: this.brushColor,
      size: this.brushSize,
      opacity: this.brushOpacity,
    };
  }

  public async importImage(
    dataUrl: string,
    name = 'Image',
  ): Promise<string> {
    this.assertUsable();
    if (!SAFE_IMAGE_DATA_URL.test(dataUrl)) {
      throw new TypeError(
        'importImage expects an embedded PNG, JPEG, or WebP Data URL.',
      );
    }

    try {
      const declared = inspectEmbeddedImageDataUrl(dataUrl).dimensions;
      const image = await FabricImage.fromURL(dataUrl);
      assertSafeImageDimensions({
        width: image.width,
        height: image.height,
      });
      const matchesHeader = imageDimensionsMatchHeader(
        { width: image.width, height: image.height },
        declared,
      );
      if (!matchesHeader) {
        throw new TypeError(
          'The embedded image header does not match its decoded dimensions.',
        );
      }
      const editorObject = image as EditorObject;
      this.initializeEditorObject(
        editorObject,
        this.uniqueLayerName(name.trim() || 'Image'),
      );

      const canvasWidth = this.documentWidth;
      const canvasHeight = this.documentHeight;
      const imageWidth = Math.max(image.width, 1);
      const imageHeight = Math.max(image.height, 1);
      const placementMargin =
        this.canvas.getObjects().length === 0 ? 1 : 0.9;
      const scale = Math.min(
        1,
        (canvasWidth * placementMargin) / imageWidth,
        (canvasHeight * placementMargin) / imageHeight,
      );
      image.set({
        left: (canvasWidth - imageWidth * scale) / 2,
        top: (canvasHeight - imageHeight * scale) / 2,
        scaleX: scale,
        scaleY: scale,
      });

      this.mutate('object-added', () => {
        this.canvas.add(image);
        this.canvas.setActiveObject(image);
      });
      this.emitStatus('画像を読み込みました。', 'success');
      return this.requireEditorId(editorObject);
    } catch (error) {
      if (!isAbortLikeError(error)) {
        this.emitStatus('画像を読み込めませんでした。', 'error');
      }
      throw error;
    }
  }

  public addRect(options: AddShapeOptions = {}): string {
    this.assertUsable();
    const width = Math.max(1, finiteOr(options.width, 240));
    const height = Math.max(1, finiteOr(options.height, 160));
    const rect = new Rect({
      left: finiteOr(options.left, (this.documentWidth - width) / 2),
      top: finiteOr(options.top, (this.documentHeight - height) / 2),
      width,
      height,
      fill: options.fill ?? '#4f46e5',
      stroke: options.stroke ?? 'transparent',
      strokeWidth: Math.max(0, finiteOr(options.strokeWidth, 0)),
      rx: 10,
      ry: 10,
    }) as EditorObject;
    this.initializeEditorObject(
      rect,
      this.uniqueLayerName(options.name?.trim() || 'Rectangle'),
    );
    this.addAndSelect(rect);
    return this.requireEditorId(rect);
  }

  public addEllipse(options: AddShapeOptions = {}): string {
    this.assertUsable();
    const width = Math.max(1, finiteOr(options.width, 220));
    const height = Math.max(1, finiteOr(options.height, 160));
    const ellipse = new Ellipse({
      left: finiteOr(options.left, (this.documentWidth - width) / 2),
      top: finiteOr(options.top, (this.documentHeight - height) / 2),
      rx: width / 2,
      ry: height / 2,
      fill: options.fill ?? '#0891b2',
      stroke: options.stroke ?? 'transparent',
      strokeWidth: Math.max(0, finiteOr(options.strokeWidth, 0)),
    }) as EditorObject;
    this.initializeEditorObject(
      ellipse,
      this.uniqueLayerName(options.name?.trim() || 'Ellipse'),
    );
    this.addAndSelect(ellipse);
    return this.requireEditorId(ellipse);
  }

  public addText(text = 'Text', options: AddTextOptions = {}): string {
    this.assertUsable();
    const value = text.length > 0 ? text : 'Text';
    const textObject = new IText(value, {
      left: finiteOr(options.left, this.documentWidth / 2 - 80),
      top: finiteOr(options.top, this.documentHeight / 2 - 24),
      fill: options.fill ?? '#111827',
      fontFamily: options.fontFamily ?? 'system-ui, sans-serif',
      fontSize: clamp(finiteOr(options.fontSize, 48), 6, 512),
      fontWeight: options.fontWeight ?? 600,
    }) as EditorObject;
    this.initializeEditorObject(
      textObject,
      this.uniqueLayerName(options.name?.trim() || 'Text'),
    );
    this.addAndSelect(textObject);
    return this.requireEditorId(textObject);
  }

  public deleteSelection(): boolean {
    this.assertUsable();
    const selected = this.canvas.getActiveObjects();
    if (selected.length === 0) {
      return false;
    }

    this.mutate('object-removed', () => {
      this.canvas.discardActiveObject();
      this.canvas.remove(...selected);
    });
    return true;
  }

  public async duplicateSelection(offset = 16): Promise<string[]> {
    this.assertUsable();
    const source = this.canvas.getActiveObjects();
    if (source.length === 0) {
      return [];
    }

    const clones = await this.cloneObjects(source);
    clones.forEach((clone) => {
      this.preparePastedObject(clone, offset);
    });

    this.mutate('duplicate', () => {
      this.canvas.discardActiveObject();
      this.canvas.add(...clones);
      this.activateObjects(clones);
    });
    return clones.map((clone) => this.requireEditorId(clone));
  }

  public getLayers(): LayerInfo[] {
    const selectedIds = new Set(this.getSelectedLayerIds());
    return [...this.canvas.getObjects()]
      .reverse()
      .map((object) => {
        const editorObject = this.normalizeEditorObject(object);
        return {
          id: this.requireEditorId(editorObject),
          name: this.requireEditorName(editorObject),
          type: this.layerType(editorObject),
          visible: editorObject.visible,
          locked: Boolean(editorObject.editorLocked),
          opacity: editorObject.opacity,
          blend: editorObject.globalCompositeOperation,
          selected: selectedIds.has(this.requireEditorId(editorObject)),
        };
      });
  }

  public getSelectedLayerIds(): string[] {
    return this.canvas
      .getActiveObjects()
      .map((object) => this.requireEditorId(this.normalizeEditorObject(object)));
  }

  public selectLayer(id: string, additive = false): boolean {
    this.assertUsable();
    const target = this.findLayer(id);
    if (!target || target.editorLocked || !target.visible) {
      return false;
    }

    this.withSuppressedEvents(() => {
      if (!additive) {
        this.canvas.discardActiveObject();
        this.canvas.setActiveObject(target);
        return;
      }

      const current = this.canvas
        .getActiveObjects()
        .filter((object) => object !== target);
      current.push(target);
      this.canvas.discardActiveObject();
      this.activateObjects(current);
    });
    this.canvas.requestRenderAll();
    this.emitSelection();
    this.emitLayers();
    return true;
  }

  public renameLayer(id: string, name: string): boolean {
    const target = this.findLayer(id);
    const trimmed = name.trim();
    if (!target || !trimmed) {
      return false;
    }
    this.mutate('layer', () => {
      target.editorName = trimmed;
    });
    return true;
  }

  public setLayerVisible(id: string, visible: boolean): boolean {
    const target = this.findLayer(id);
    if (!target) {
      return false;
    }
    this.mutate('layer', () => {
      target.set('visible', visible);
      if (!visible && this.canvas.getActiveObjects().includes(target)) {
        this.canvas.discardActiveObject();
      }
    });
    return true;
  }

  public setLayerLocked(id: string, locked: boolean): boolean {
    const target = this.findLayer(id);
    if (!target) {
      return false;
    }
    this.mutate('layer', () => {
      target.editorLocked = locked;
      this.configureSingleObjectInteractivity(target);
      if (locked && this.canvas.getActiveObjects().includes(target)) {
        this.canvas.discardActiveObject();
      }
    });
    return true;
  }

  public setLayerOpacity(id: string, opacity: number): boolean {
    const target = this.findLayer(id);
    if (!target || !Number.isFinite(opacity)) {
      return false;
    }
    this.mutate('layer-opacity', () => {
      target.set('opacity', clamp(opacity, 0, 1));
    });
    return true;
  }

  public setLayerBlend(
    id: string,
    blend: GlobalCompositeOperation,
  ): boolean {
    const target = this.findLayer(id);
    if (!target) {
      return false;
    }
    this.mutate('layer', () => {
      target.set('globalCompositeOperation', blend);
    });
    return true;
  }

  /**
   * Moves a layer to a zero-based index in the order returned by getLayers
   * (index 0 is the visually topmost/front layer).
   */
  public moveLayer(id: string, index: number): boolean {
    const target = this.findLayer(id);
    const objects = this.canvas.getObjects();
    if (!target || !Number.isFinite(index) || objects.length < 2) {
      return false;
    }
    const uiIndex = clamp(Math.round(index), 0, objects.length - 1);
    const canvasIndex = objects.length - 1 - uiIndex;
    this.mutate('layer', () => {
      this.canvas.moveObjectTo(target, canvasIndex);
    });
    return true;
  }

  public moveLayerForward(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.bringObjectForward(object),
    );
  }

  public moveLayerBackward(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.sendObjectBackwards(object),
    );
  }

  public moveLayerToFront(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.bringObjectToFront(object),
    );
  }

  public moveLayerToBack(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.sendObjectToBack(object),
    );
  }

  public getSelectionTransform(): SelectionTransform | null {
    const selected = this.canvas.getActiveObjects();
    if (selected.length !== 1) {
      return null;
    }
    const object = this.normalizeEditorObject(selected[0]);
    return {
      id: this.requireEditorId(object),
      left: object.left,
      top: object.top,
      width: object.getScaledWidth(),
      height: object.getScaledHeight(),
      angle: object.angle,
      flipX: object.flipX,
      flipY: object.flipY,
    };
  }

  public updateSelectionTransform(
    update: SelectionTransformUpdate,
  ): boolean {
    this.assertUsable();
    const selected = this.canvas.getActiveObjects();
    if (selected.length !== 1) {
      return false;
    }
    const object = selected[0];
    if ((object as EditorObject).editorLocked) {
      return false;
    }

    this.mutate('object-modified', () => {
      if (typeof update.left === 'number' && Number.isFinite(update.left)) {
        object.set('left', update.left);
      }
      if (typeof update.top === 'number' && Number.isFinite(update.top)) {
        object.set('top', update.top);
      }
      if (typeof update.angle === 'number' && Number.isFinite(update.angle)) {
        object.set('angle', update.angle);
      }
      if (typeof update.flipX === 'boolean') {
        object.set('flipX', update.flipX);
      }
      if (typeof update.flipY === 'boolean') {
        object.set('flipY', update.flipY);
      }
      if (
        typeof update.width === 'number' &&
        Number.isFinite(update.width) &&
        update.width > 0
      ) {
        const currentWidth = Math.max(object.getScaledWidth(), EPSILON);
        object.set(
          'scaleX',
          object.scaleX * (update.width / currentWidth),
        );
      }
      if (
        typeof update.height === 'number' &&
        Number.isFinite(update.height) &&
        update.height > 0
      ) {
        const currentHeight = Math.max(object.getScaledHeight(), EPSILON);
        object.set(
          'scaleY',
          object.scaleY * (update.height / currentHeight),
        );
      }
      object.setCoords();
    });
    return true;
  }

  public getZoom(): number {
    return this.canvas.getZoom();
  }

  public setZoom(zoom: number): number {
    this.assertUsable();
    const nextZoom = clamp(finiteOr(zoom, 1), MIN_ZOOM, MAX_ZOOM);
    const center = new Point(
      this.canvas.getWidth() / 2,
      this.canvas.getHeight() / 2,
    );
    this.canvas.zoomToPoint(center, nextZoom);
    this.canvas.requestRenderAll();
    this.emitZoom();
    return nextZoom;
  }

  public zoomIn(factor = 1.2): number {
    const safeFactor = Math.max(1.01, finiteOr(factor, 1.2));
    return this.setZoom(this.getZoom() * safeFactor);
  }

  public zoomOut(factor = 1.2): number {
    const safeFactor = Math.max(1.01, finiteOr(factor, 1.2));
    return this.setZoom(this.getZoom() / safeFactor);
  }

  public zoom100(): number {
    return this.setZoom(1);
  }

  /**
   * Fits document pixels into a host-provided viewport. The Fabric surface and
   * its CSS box become the viewport size; document pixels remain independent.
   */
  public fitToViewport(
    viewportWidth: number,
    viewportHeight: number,
    padding = 32,
  ): number {
    this.assertUsable();
    const safeViewportWidth = Math.max(
      1,
      Math.round(finiteOr(viewportWidth, this.canvas.getWidth())),
    );
    const safeViewportHeight = Math.max(
      1,
      Math.round(finiteOr(viewportHeight, this.canvas.getHeight())),
    );
    const safePadding = Math.max(0, finiteOr(padding, 32));
    const availableWidth = Math.max(
      1,
      safeViewportWidth - safePadding * 2,
    );
    const availableHeight = Math.max(
      1,
      safeViewportHeight - safePadding * 2,
    );
    const zoom = clamp(
      Math.min(
        availableWidth / this.documentWidth,
        availableHeight / this.documentHeight,
      ),
      MIN_FIT_ZOOM,
      MAX_ZOOM,
    );
    const offsetX =
      (safeViewportWidth - this.documentWidth * zoom) / 2;
    const offsetY =
      (safeViewportHeight - this.documentHeight * zoom) / 2;
    this.canvas.setDimensions({
      width: safeViewportWidth,
      height: safeViewportHeight,
    });
    this.canvas.setViewportTransform([
      zoom,
      0,
      0,
      zoom,
      offsetX,
      offsetY,
    ]);
    this.canvas.requestRenderAll();
    this.emitZoom();
    return zoom;
  }

  public panBy(deltaX: number, deltaY: number): void {
    this.assertUsable();
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    const transform = [...this.canvas.viewportTransform] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    transform[4] += deltaX;
    transform[5] += deltaY;
    this.canvas.setViewportTransform(transform);
    this.canvas.requestRenderAll();
  }

  public resetViewport(): void {
    this.assertUsable();
    this.canvas.setViewportTransform([...iMatrix]);
    this.canvas.requestRenderAll();
    this.emitZoom();
  }

  public getDocumentSize(): { width: number; height: number } {
    return {
      width: this.documentWidth,
      height: this.documentHeight,
    };
  }

  public getViewportSize(): { width: number; height: number } {
    return {
      width: this.canvas.getWidth(),
      height: this.canvas.getHeight(),
    };
  }

  /**
   * Starts an empty document while preserving the current viewport transform.
   * Supplying dimensions changes only the logical document pixel size.
   */
  public clear(width?: number, height?: number): void {
    this.assertUsable();
    const nextWidth = documentDimension(
      finiteOr(width, this.documentWidth),
    );
    const nextHeight = documentDimension(
      finiteOr(height, this.documentHeight),
    );
    this.mutate('clear', () => {
      const objects = this.canvas.getObjects();
      this.canvas.discardActiveObject();
      if (objects.length > 0) {
        this.canvas.remove(...objects);
      }
      this.documentWidth = nextWidth;
      this.documentHeight = nextHeight;
      this.setDocumentClip();
      this.clipboard = [];
      this.pasteGeneration = 0;
    });
  }

  /**
   * Changes logical document pixels without resizing the display viewport.
   */
  public setCanvasSize(width: number, height: number): void {
    this.assertUsable();
    const safeWidth = documentDimension(width);
    const safeHeight = documentDimension(height);
    if (
      safeWidth === this.documentWidth &&
      safeHeight === this.documentHeight
    ) {
      return;
    }

    this.mutate('canvas-size', () => {
      this.documentWidth = safeWidth;
      this.documentHeight = safeHeight;
      this.setDocumentClip();
    });
  }

  public cropToSelection(): { width: number; height: number } | null {
    this.assertUsable();
    const activeObject = this.canvas.getActiveObject();
    if (!activeObject) {
      this.emitStatus('切り抜く範囲を選択してください。', 'warning');
      return null;
    }

    const bounds = activeObject.getBoundingRect();
    const left = clamp(
      Math.floor(bounds.left),
      0,
      this.documentWidth - 1,
    );
    const top = clamp(
      Math.floor(bounds.top),
      0,
      this.documentHeight - 1,
    );
    const right = clamp(
      Math.ceil(bounds.left + bounds.width),
      left + 1,
      this.documentWidth,
    );
    const bottom = clamp(
      Math.ceil(bounds.top + bounds.height),
      top + 1,
      this.documentHeight,
    );
    const width = documentDimension(right - left);
    const height = documentDimension(bottom - top);

    this.mutate('crop', () => {
      this.canvas.discardActiveObject();
      this.canvas.getObjects().forEach((object) => {
        object.set({
          left: object.left - left,
          top: object.top - top,
        });
        object.setCoords();
      });
      this.documentWidth = width;
      this.documentHeight = height;
      this.setDocumentClip();
      this.canvas.setViewportTransform([...iMatrix]);
    });
    this.emitZoom();
    return { width, height };
  }

  public applyImageFilters(settings: ImageFilterSettings): boolean {
    this.assertUsable();
    const selected = this.canvas.getActiveObjects();
    if (selected.length !== 1 || !(selected[0] instanceof FabricImage)) {
      this.emitStatus(
        'フィルターを適用する画像レイヤーを1つ選択してください。',
        'warning',
      );
      return false;
    }

    const image = selected[0];
    const nextFilters: FabricImage['filters'] = [];
    const brightness = clamp(
      finiteOr(settings.brightness, 0),
      -1,
      1,
    );
    const contrast = clamp(finiteOr(settings.contrast, 0), -1, 1);
    const saturation = clamp(
      finiteOr(settings.saturation, 0),
      -1,
      1,
    );
    const hue = clamp(finiteOr(settings.hue, 0), -1, 1);
    const blur = clamp(finiteOr(settings.blur, 0), 0, 1);

    if (Math.abs(brightness) > EPSILON) {
      nextFilters.push(new filters.Brightness({ brightness }));
    }
    if (Math.abs(contrast) > EPSILON) {
      nextFilters.push(new filters.Contrast({ contrast }));
    }
    if (Math.abs(saturation) > EPSILON) {
      nextFilters.push(new filters.Saturation({ saturation }));
    }
    if (Math.abs(hue) > EPSILON) {
      nextFilters.push(new filters.HueRotation({ rotation: hue }));
    }
    if (blur > EPSILON) {
      nextFilters.push(new filters.Blur({ blur }));
    }
    if (settings.grayscale) {
      nextFilters.push(new filters.Grayscale({ mode: 'luminosity' }));
    }

    this.mutate('filter', () => {
      image.filters = nextFilters;
      image.applyFilters();
      image.set('dirty', true);
    });
    return true;
  }

  /**
   * Reads editable filter parameters from the single selected image.
   * Returns null for non-image or multi-selection states.
   */
  public getSelectedImageFilters(): Required<ImageFilterSettings> | null {
    this.assertUsable();
    const selected = this.canvas.getActiveObjects();
    if (selected.length !== 1 || !(selected[0] instanceof FabricImage)) {
      return null;
    }

    const settings: Required<ImageFilterSettings> = {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      hue: 0,
      blur: 0,
      grayscale: false,
    };

    selected[0].filters.forEach((filter) => {
      if (filter instanceof filters.Brightness) {
        settings.brightness = filter.brightness;
      } else if (filter instanceof filters.Contrast) {
        settings.contrast = filter.contrast;
      } else if (filter instanceof filters.Saturation) {
        settings.saturation = filter.saturation;
      } else if (filter instanceof filters.HueRotation) {
        settings.hue = filter.rotation;
      } else if (filter instanceof filters.Blur) {
        settings.blur = filter.blur;
      } else if (filter instanceof filters.Grayscale) {
        settings.grayscale = true;
      }
    });

    return settings;
  }

  public snapshot(): EditorSnapshot {
    this.assertUsable();
    const activeObject = this.canvas.getActiveObject();
    const selected = this.canvas.getActiveObjects();
    const needsTemporaryUngroup = activeObject instanceof ActiveSelection;
    let json: Record<string, unknown>;

    this.withSuppressedEvents(() => {
      if (needsTemporaryUngroup) {
        this.canvas.discardActiveObject();
      }
      try {
        json = this.canvas.toObject([
          ...SERIALIZED_EDITOR_PROPERTIES,
        ]) as Record<string, unknown>;
      } finally {
        if (needsTemporaryUngroup) {
          this.activateObjects(selected);
          this.canvas.requestRenderAll();
        }
      }
    });
    return {
      json: json!,
      width: this.documentWidth,
      height: this.documentHeight,
    };
  }

  /**
   * Restores are serialized to avoid Fabric's asynchronous enlivening races.
   * No onChanged callback is fired, which prevents undo/redo from recursively
   * creating new history entries.
   */
  public restore(snapshot: EditorSnapshot): Promise<void> {
    this.assertUsable();
    const queued = this.restoreQueue
      .catch(() => undefined)
      .then(async () => {
        const rollback = this.snapshot();
        try {
          await this.performRestore(snapshot);
        } catch (error) {
          try {
            await this.performRestore(rollback);
          } catch {
            // Preserve the original error. A second failure is non-actionable
            // and the render flags/clip are still repaired in performRestore.
          }
          throw error;
        }
      });
    this.restoreQueue = queued;
    return queued;
  }

  public exportDataUrl(
    format: ExportImageFormat = 'png',
    quality = 0.92,
    multiplier = 1,
  ): string {
    this.assertUsable();
    const previousTransform = [
      ...this.canvas.viewportTransform,
    ] as typeof this.canvas.viewportTransform;
    const previousViewportWidth = this.canvas.getWidth();
    const previousViewportHeight = this.canvas.getHeight();
    let dataUrl: string;
    try {
      this.isExporting = true;
      this.withSuppressedEvents(() => {
        this.canvas.setDimensions(
          {
            width: this.documentWidth,
            height: this.documentHeight,
          },
          { backstoreOnly: true },
        );
        this.canvas.setViewportTransform([...iMatrix]);
        this.canvas.requestRenderAll();
      });
      dataUrl = this.canvas.toDataURL({
        format,
        quality: clamp(finiteOr(quality, 0.92), 0, 1),
        multiplier: clamp(finiteOr(multiplier, 1), 0.1, 8),
        left: 0,
        top: 0,
        width: this.documentWidth,
        height: this.documentHeight,
        enableRetinaScaling: false,
      });
      this.emitStatus('画像を書き出しました。', 'success');
    } finally {
      this.isExporting = false;
      this.withSuppressedEvents(() => {
        this.canvas.setDimensions(
          {
            width: previousViewportWidth,
            height: previousViewportHeight,
          },
          { backstoreOnly: true },
        );
        this.canvas.setViewportTransform(previousTransform);
        this.canvas.requestRenderAll();
      });
    }
    return dataUrl;
  }

  public async copySelection(): Promise<boolean> {
    this.assertUsable();
    const selected = this.canvas.getActiveObjects();
    if (selected.length === 0) {
      return false;
    }
    this.clipboard = await this.cloneObjects(selected);
    this.pasteGeneration = 0;
    this.emitStatus('選択範囲をコピーしました。', 'info');
    return true;
  }

  public async cutSelection(): Promise<boolean> {
    this.assertUsable();
    const copied = await this.copySelection();
    if (!copied) {
      return false;
    }
    const selected = this.canvas.getActiveObjects();
    this.mutate('cut', () => {
      this.canvas.discardActiveObject();
      this.canvas.remove(...selected);
    });
    return true;
  }

  public async pasteSelection(offset = 16): Promise<string[]> {
    this.assertUsable();
    if (this.clipboard.length === 0) {
      return [];
    }
    const clones = await this.cloneObjects(this.clipboard);
    this.pasteGeneration += 1;
    const appliedOffset =
      Math.max(0, finiteOr(offset, 16)) * this.pasteGeneration;
    clones.forEach((clone) => {
      this.preparePastedObject(clone, appliedOffset);
    });

    this.mutate('paste', () => {
      this.canvas.discardActiveObject();
      this.canvas.add(...clones);
      this.activateObjects(clones);
    });
    return clones.map((clone) => this.requireEditorId(clone));
  }

  private bindEvents(): void {
    this.eventDisposers.push(
      this.canvas.on('object:added', ({ target }) => {
        const object = this.normalizeEditorObject(target);
        if (
          this.currentTool === 'eraser' &&
          this.canvas.isDrawingMode &&
          object.type === 'path'
        ) {
          object.set({
            globalCompositeOperation: 'destination-out',
            opacity: this.brushOpacity,
          });
          object.editorName = this.uniqueLayerName('Eraser stroke');
        } else if (
          this.currentTool === 'brush' &&
          this.canvas.isDrawingMode &&
          object.type === 'path'
        ) {
          object.set('opacity', this.brushOpacity);
          object.editorName = this.uniqueLayerName('Brush stroke');
        }
        this.handleDocumentEvent('object-added');
      }),
      this.canvas.on('object:removed', () => {
        this.handleDocumentEvent('object-removed');
      }),
      this.canvas.on('object:modified', () => {
        this.handleDocumentEvent('object-modified');
      }),
      this.canvas.on('text:changed', () => {
        this.handleDocumentEvent('text-changed');
      }),
      this.canvas.on('selection:created', () => {
        this.handleSelectionEvent();
      }),
      this.canvas.on('selection:updated', () => {
        this.handleSelectionEvent();
      }),
      this.canvas.on('selection:cleared', () => {
        this.handleSelectionEvent();
      }),
      this.canvas.on('mouse:down', ({ e, viewportPoint }) => {
        if (this.currentTool !== 'pan') {
          return;
        }
        this.isPanning = true;
        this.lastPanPoint = new Point(viewportPoint.x, viewportPoint.y);
        this.canvas.defaultCursor = 'grabbing';
        e.preventDefault();
      }),
      this.canvas.on('mouse:move', ({ e, viewportPoint }) => {
        if (
          this.currentTool !== 'pan' ||
          !this.isPanning ||
          !this.lastPanPoint
        ) {
          return;
        }
        const nextPoint = new Point(viewportPoint.x, viewportPoint.y);
        this.panBy(
          nextPoint.x - this.lastPanPoint.x,
          nextPoint.y - this.lastPanPoint.y,
        );
        this.lastPanPoint = nextPoint;
        e.preventDefault();
      }),
      this.canvas.on('mouse:up', () => {
        if (this.currentTool !== 'pan') {
          return;
        }
        this.isPanning = false;
        this.lastPanPoint = null;
        this.canvas.defaultCursor = 'grab';
      }),
      this.canvas.on('mouse:wheel', ({ e, viewportPoint }) => {
        const wheel = e as WheelEvent;
        wheel.preventDefault();
        wheel.stopPropagation();
        const nextZoom = clamp(
          this.canvas.getZoom() * 0.999 ** wheel.deltaY,
          MIN_ZOOM,
          MAX_ZOOM,
        );
        this.canvas.zoomToPoint(viewportPoint, nextZoom);
        this.canvas.requestRenderAll();
        this.emitZoom();
      }),
      this.canvas.on('after:render', ({ ctx }) => {
        this.renderDocumentFrame(ctx);
      }),
    );
  }

  private setDocumentClip(): void {
    const clip = new Rect({
      left: 0,
      top: 0,
      width: this.documentWidth,
      height: this.documentHeight,
      originX: 'left',
      originY: 'top',
      absolutePositioned: true,
      fill: '#000000',
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    this.canvas.clipPath = clip;
  }

  private renderDocumentFrame(ctx: CanvasRenderingContext2D): void {
    if (this.isExporting || this.disposed) {
      return;
    }

    const [a, b, c, d, e, f] = this.canvas.viewportTransform;
    const corners = [
      [e, f],
      [a * this.documentWidth + e, b * this.documentWidth + f],
      [c * this.documentHeight + e, d * this.documentHeight + f],
      [
        a * this.documentWidth + c * this.documentHeight + e,
        b * this.documentWidth + d * this.documentHeight + f,
      ],
    ];
    const xValues = corners.map(([x]) => x);
    const yValues = corners.map(([, y]) => y);
    const left = Math.min(...xValues);
    const top = Math.min(...yValues);
    const right = Math.max(...xValues);
    const bottom = Math.max(...yValues);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, this.canvas.getWidth(), this.canvas.getHeight());
    ctx.rect(left, top, right - left, bottom - top);
    ctx.fillStyle = 'rgba(3, 6, 12, 0.72)';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(left) + 0.5,
      Math.round(top) + 0.5,
      Math.max(0, Math.round(right - left) - 1),
      Math.max(0, Math.round(bottom - top) - 1),
    );
    ctx.restore();
  }

  private applyBrushOptions(): void {
    const brush =
      this.canvas.freeDrawingBrush ??
      (this.canvas.freeDrawingBrush = new PencilBrush(this.canvas));
    brush.color =
      this.currentTool === 'eraser' ? '#000000' : this.brushColor;
    brush.width = this.brushSize;
  }

  private initializeEditorObject(
    object: EditorObject,
    name: string,
  ): void {
    object.editorId = object.editorId || createEditorId();
    object.editorName = object.editorName || name;
    object.editorLocked = Boolean(object.editorLocked);
    this.configureSingleObjectInteractivity(object);
  }

  private normalizeEditorObject(object: FabricObject): EditorObject {
    const editorObject = object as EditorObject;
    this.initializeEditorObject(
      editorObject,
      this.uniqueLayerName(this.defaultNameForObject(editorObject)),
    );
    return editorObject;
  }

  private configureObjectInteractivity(): void {
    this.canvas.getObjects().forEach((object) => {
      this.configureSingleObjectInteractivity(
        this.normalizeEditorObject(object),
      );
    });
  }

  private configureSingleObjectInteractivity(object: EditorObject): void {
    const interactive =
      this.currentTool === 'select' && !object.editorLocked;
    object.set({
      selectable: interactive,
      evented: interactive,
      hasControls: interactive,
      lockMovementX: Boolean(object.editorLocked),
      lockMovementY: Boolean(object.editorLocked),
      lockRotation: Boolean(object.editorLocked),
      lockScalingX: Boolean(object.editorLocked),
      lockScalingY: Boolean(object.editorLocked),
      lockSkewingX: Boolean(object.editorLocked),
      lockSkewingY: Boolean(object.editorLocked),
    });
  }

  private addAndSelect(object: EditorObject): void {
    this.mutate('object-added', () => {
      this.canvas.add(object);
      this.canvas.setActiveObject(object);
    });
  }

  private activateObjects(objects: FabricObject[]): void {
    if (objects.length === 0) {
      return;
    }
    if (objects.length === 1) {
      this.canvas.setActiveObject(objects[0]);
      return;
    }
    this.canvas.setActiveObject(new ActiveSelection(objects));
  }

  private findLayer(id: string): EditorObject | undefined {
    return this.canvas
      .getObjects()
      .map((object) => this.normalizeEditorObject(object))
      .find((object) => object.editorId === id);
  }

  private moveLayerWith(
    id: string,
    move: (object: FabricObject) => boolean,
  ): boolean {
    const target = this.findLayer(id);
    if (!target) {
      return false;
    }
    let moved = false;
    this.withSuppressedEvents(() => {
      moved = move(target);
    });
    if (!moved) {
      return false;
    }
    this.finishMutation('layer');
    return true;
  }

  private async cloneObjects(
    objects: FabricObject[],
  ): Promise<ClipboardObject[]> {
    const activeObject = this.canvas.getActiveObject();
    const needsTemporaryUngroup =
      activeObject instanceof ActiveSelection &&
      objects.some((object) => object.group === activeObject);

    if (needsTemporaryUngroup) {
      this.eventSuppressionDepth += 1;
      this.canvas.discardActiveObject();
    }
    try {
      return await Promise.all(
        objects.map(async (object) => {
          const clone = (await object.clone([
            ...SERIALIZED_EDITOR_PROPERTIES,
          ])) as ClipboardObject;
          return this.normalizeEditorObject(clone);
        }),
      );
    } finally {
      if (needsTemporaryUngroup) {
        try {
          this.activateObjects(objects);
          this.canvas.requestRenderAll();
        } finally {
          this.eventSuppressionDepth -= 1;
        }
      }
    }
  }

  private preparePastedObject(
    object: ClipboardObject,
    offset: number,
  ): void {
    const originalName = this.requireEditorName(object);
    object.editorId = createEditorId();
    object.editorName = this.uniqueLayerName(`${originalName} copy`);
    object.set({
      left: object.left + offset,
      top: object.top + offset,
    });
    this.configureSingleObjectInteractivity(object);
    object.setCoords();
  }

  private async performRestore(snapshot: EditorSnapshot): Promise<void> {
    assertRestorableEditorSnapshot(snapshot);

    this.eventSuppressionDepth += 1;
    const previousRenderOnAddRemove = this.canvas.renderOnAddRemove;
    try {
      this.canvas.discardActiveObject();
      await this.canvas.loadFromJSON(
        snapshot.json,
        (serialized, object) => {
          if (!object) {
            return;
          }
          const editorObject = object as EditorObject;
          const record = serialized as Record<string, unknown>;
          editorObject.editorId =
            typeof record.editorId === 'string'
              ? record.editorId
              : createEditorId();
          editorObject.editorName =
            typeof record.editorName === 'string'
              ? record.editorName
              : this.defaultNameForObject(editorObject);
          editorObject.editorLocked = Boolean(record.editorLocked);
        },
      );
      this.documentWidth = documentDimension(snapshot.width);
      this.documentHeight = documentDimension(snapshot.height);
      this.setDocumentClip();
      this.canvas.setViewportTransform([...iMatrix]);
      this.configureObjectInteractivity();
      this.canvas.requestRenderAll();
    } finally {
      this.canvas.renderOnAddRemove = previousRenderOnAddRemove;
      this.setDocumentClip();
      this.eventSuppressionDepth -= 1;
    }

    this.emitLayers();
    this.emitSelection();
    this.emitZoom();
  }

  private mutate(
    reason: EditorChangeReason,
    mutation: () => void,
  ): void {
    this.assertUsable();
    this.withSuppressedEvents(mutation);
    this.finishMutation(reason);
  }

  private finishMutation(reason: EditorChangeReason): void {
    this.canvas.requestRenderAll();
    this.callbacks.onChanged?.(reason);
    this.emitSelection();
    this.emitLayers();
  }

  private withSuppressedEvents<T>(operation: () => T): T {
    this.eventSuppressionDepth += 1;
    try {
      return operation();
    } finally {
      this.eventSuppressionDepth -= 1;
    }
  }

  private handleDocumentEvent(reason: EditorChangeReason): void {
    if (this.eventSuppressionDepth > 0 || this.disposed) {
      return;
    }
    this.canvas.requestRenderAll();
    this.callbacks.onChanged?.(reason);
    this.emitSelection();
    this.emitLayers();
  }

  private handleSelectionEvent(): void {
    if (this.eventSuppressionDepth > 0 || this.disposed) {
      return;
    }
    this.emitSelection();
    this.emitLayers();
  }

  private emitLayers(): void {
    if (!this.disposed) {
      this.callbacks.onLayersChanged?.(this.getLayers());
    }
  }

  private emitSelection(): void {
    if (!this.disposed) {
      this.callbacks.onSelectionChanged?.(this.getSelectedLayerIds());
    }
  }

  private emitZoom(): void {
    if (!this.disposed) {
      this.callbacks.onZoomChanged?.(this.canvas.getZoom());
    }
  }

  private emitStatus(message: string, kind: EditorStatusKind): void {
    if (!this.disposed) {
      this.callbacks.onStatus?.({ message, kind });
    }
  }

  private uniqueLayerName(baseName: string): string {
    const normalized = baseName.trim() || 'Layer';
    const names = new Set(
      this.canvas
        .getObjects()
        .map((object) => (object as EditorObject).editorName)
        .filter((name): name is string => Boolean(name)),
    );
    if (!names.has(normalized)) {
      return normalized;
    }

    let suffix = 2;
    while (names.has(`${normalized} ${suffix}`)) {
      suffix += 1;
    }
    return `${normalized} ${suffix}`;
  }

  private defaultNameForObject(object: FabricObject): string {
    if (object instanceof FabricImage) {
      return 'Image';
    }
    if (object instanceof Rect) {
      return 'Rectangle';
    }
    if (object instanceof Ellipse) {
      return 'Ellipse';
    }
    if (object instanceof IText) {
      return 'Text';
    }
    if (object.type === 'path') {
      return 'Brush stroke';
    }
    return 'Layer';
  }

  private layerType(object: FabricObject): string {
    if (object instanceof FabricImage) {
      return 'image';
    }
    if (object instanceof IText) {
      return 'text';
    }
    if (object instanceof Rect) {
      return 'rectangle';
    }
    if (object instanceof Ellipse) {
      return 'ellipse';
    }
    if (object.type === 'path') {
      return object.globalCompositeOperation === 'destination-out'
        ? 'eraser'
        : 'brush';
    }
    return object.type || 'object';
  }

  private requireEditorId(object: EditorObject): string {
    if (!object.editorId) {
      object.editorId = createEditorId();
    }
    return object.editorId;
  }

  private requireEditorName(object: EditorObject): string {
    if (!object.editorName) {
      object.editorName = this.uniqueLayerName(
        this.defaultNameForObject(object),
      );
    }
    return object.editorName;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('FabricEditorEngine has been disposed.');
    }
  }
}
