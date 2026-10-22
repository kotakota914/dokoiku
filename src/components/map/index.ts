/**
 * 地図部品のまとめ。SpotMap 本体は maplibre-gl を含むため、ここからは SpotMapLazy だけを出す。
 * 直接 SpotMap が必要なクライアント部品は "./SpotMap" を import する。
 */
export { default as SpotMapLazy, MapSkeleton } from "./SpotMapLazy";
export type { SpotMapProps, RouteGeometry, MapBaseMarker } from "./SpotMap";
export { default as RouteMap, type RouteMapProps } from "./RouteMap";
export { default as LocateButton, type LocateButtonProps } from "./LocateButton";
export { MapContext, useMap, type MapContextValue, type CurrentLocation } from "./MapContext";
export {
  getCurrentPosition,
  geolocationErrorMessage,
  useGeolocation,
  GeolocationFailure,
  GEOLOCATION_MESSAGES,
  type GeolocationErrorKind,
  type UseGeolocationResult,
} from "./useGeolocation";
export {
  useViewportSpots,
  buildSpotsPath,
  toResponse,
  type Viewport,
  type UseViewportSpotsOptions,
  type UseViewportSpotsResult,
} from "./useViewportSpots";
export {
  createPinElement,
  updatePinElement,
  createClusterElement,
  updateClusterElement,
  createStopElement,
  updateStopElement,
  createLocationDotElement,
  createBaseElement,
  updateBaseElement,
  fadeInMarker,
  fadeOutMarker,
  disposeMarkerElement,
  pinAriaLabel,
  clusterAriaLabel,
  type PinSpec,
  type ClusterSpec,
  type StopSpec,
} from "./markers";
