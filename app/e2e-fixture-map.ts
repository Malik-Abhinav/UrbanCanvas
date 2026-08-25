import type { Map } from "mapbox-gl";

declare global {
  interface Window {
    /** Fixtures-only test hook; never compiled into production bundles. */
    __releaseUrbanCanvasE2eMap?: () => void;
    /** Fixtures-only test hook: change the simulated map zoom (emits "move"). */
    __setUrbanCanvasE2eMapZoom?: (zoom: number) => void;
  }
}

const delhiCenter: [number, number] = [77.209, 28.6139];

export function createE2eFixtureMap(container: HTMLDivElement): Map {
  const interactions = {
    disable() {},
    enable() {}
  };
  const sources = new globalThis.Map<string, { setData: (data: unknown) => void }>();
  const layers = new Set<string>();
  const listeners = new globalThis.Map<string, Set<() => void>>();
  const onceListeners = new globalThis.Map<string, () => void>();
  const pendingTimers = new Set<number>();
  let styleLoaded = false;
  let currentZoom = 12;
  const scale = 0.00002;

  const getSize = () => ({
    height: Math.max(container.clientHeight, 600),
    width: Math.max(container.clientWidth, 800)
  });
  const emitAsync = (event: string) => {
    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      const callback = onceListeners.get(event);
      onceListeners.delete(event);
      callback?.();
    }, 0);
    pendingTimers.add(timer);
  };
  const emit = (event: string) => {
    for (const callback of listeners.get(event) ?? []) {
      callback();
    }
  };
  const releaseInitialLoad = () => {
    if (styleLoaded) {
      return;
    }
    styleLoaded = true;
    emit("styledata");
    emit("load");
    emit("idle");
  };

  const fixtureMap = {
    addLayer(layer: { id: string }) {
      layers.add(layer.id);
    },
    addSource(id: string) {
      sources.set(id, { setData() {} });
    },
    boxZoom: interactions,
    doubleClickZoom: interactions,
    dragPan: interactions,
    dragRotate: interactions,
    easeTo() {
      emitAsync("moveend");
    },
    fitBounds() {
      emitAsync("moveend");
    },
    getCanvas() {
      return container;
    },
    getCenter() {
      return { lat: delhiCenter[1], lng: delhiCenter[0] };
    },
    getLayer(id: string) {
      return layers.has(id) ? { id } : undefined;
    },
    getSource(id: string) {
      return sources.get(id);
    },
    getZoom() {
      return currentZoom;
    },
    isStyleLoaded() {
      return styleLoaded;
    },
    keyboard: interactions,
    loaded() {
      return styleLoaded;
    },
    on(event: string, callback: () => void) {
      const eventListeners = listeners.get(event) ?? new Set<() => void>();
      eventListeners.add(callback);
      listeners.set(event, eventListeners);
      return fixtureMap;
    },
    once(event: string, callback: () => void) {
      onceListeners.set(event, callback);
    },
    panBy() {
      emitAsync("moveend");
    },
    project(point: [number, number]) {
      const { height, width } = getSize();
      return {
        x: width / 2 + (point[0] - delhiCenter[0]) / scale,
        y: height / 2 + (delhiCenter[1] - point[1]) / scale
      };
    },
    remove() {
      for (const timer of pendingTimers) {
        window.clearTimeout(timer);
      }
      pendingTimers.clear();
      listeners.clear();
      onceListeners.clear();
      if (window.__releaseUrbanCanvasE2eMap === releaseInitialLoad) {
        delete window.__releaseUrbanCanvasE2eMap;
      }
    },
    resize() {},
    scrollZoom: interactions,
    touchZoomRotate: interactions,
    unproject(point: [number, number]) {
      const { height, width } = getSize();
      return {
        lat: delhiCenter[1] - (point[1] - height / 2) * scale,
        lng: delhiCenter[0] + (point[0] - width / 2) * scale
      };
    }
  };

  window.__releaseUrbanCanvasE2eMap = releaseInitialLoad;
  window.__setUrbanCanvasE2eMapZoom = (zoom: number) => {
    currentZoom = zoom;
    // Mirrors the real map: zoom changes fire "move", which the workspace
    // coalesces into a map revision bump.
    emit("move");
  };

  return fixtureMap as unknown as Map;
}
