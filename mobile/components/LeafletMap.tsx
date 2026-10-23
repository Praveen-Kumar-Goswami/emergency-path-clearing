import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'ambulance' | 'destination' | 'self';
  heading?: number | null;
}

export interface LeafletMapProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  route?: [number, number][] | null; // Array of [lat, lng]
  onMapPress?: (coords: { lat: number; lng: number }) => void;
  fitToRoute?: boolean;
  follow?: [number, number] | null;
  style?: any;
}

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
  <style>
    html, body, #map {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      background: #0f172a;
    }
    .leaflet-control-attribution {
      font-size: 9px !important;
      background: rgba(255,255,255,0.7) !important;
    }
    .ambulance-arrow {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s linear;
    }
    .ambulance-arrow svg {
      filter: drop-shadow(0 2px 5px rgba(220, 38, 38, 0.6));
    }
    .self-dot {
      width: 18px;
      height: 18px;
      background: #2563eb;
      border: 3px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 10px rgba(37, 99, 235, 0.8);
    }
    .destination-pin {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
</head>
<body>
  <div id="map"></div>
  <script>
    var map;
    var markersLayer = L.layerGroup();
    var routeLayer = L.layerGroup();

    function initMap(lat, lng, zoom) {
      map = L.map('map', {
        zoomControl: false,
        attributionControl: true
      }).setView([lat, lng], zoom || 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      markersLayer.addTo(map);
      routeLayer.addTo(map);

      map.on('click', function(e) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'map_press',
            lat: e.latlng.lat,
            lng: e.latlng.lng
          }));
        }
      });
    }

    function createAmbulanceIcon(heading) {
      var rot = heading || 0;
      return L.divIcon({
        className: 'ambulance-icon-container',
        html: '<div class="ambulance-arrow" style="transform: rotate(' + rot + 'deg);">' +
              '<svg width="32" height="32" viewBox="0 0 32 32" fill="none">' +
              '<polygon points="16,2 30,28 16,22 2,28" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>' +
              '</svg></div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
    }

    function createSelfIcon() {
      return L.divIcon({
        className: 'self-icon-container',
        html: '<div class="self-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
    }

    function createDestinationIcon() {
      return L.divIcon({
        className: 'dest-icon-container',
        html: '<div class="destination-pin">' +
              '<svg width="24" height="24" viewBox="0 0 24 24" fill="#16a34a" stroke="#ffffff" stroke-width="1.5">' +
              '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>' +
              '</svg></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      });
    }

    function updateMarkers(markers) {
      if (!map) return;
      markersLayer.clearLayers();
      if (!markers || !markers.length) return;

      markers.forEach(function(m) {
        var icon;
        if (m.kind === 'ambulance') {
          icon = createAmbulanceIcon(m.heading);
        } else if (m.kind === 'destination') {
          icon = createDestinationIcon();
        } else {
          icon = createSelfIcon();
        }
        L.marker([m.lat, m.lng], { icon: icon }).addTo(markersLayer);
      });
    }

    function updateRoute(routeCoords, fit) {
      if (!map) return;
      routeLayer.clearLayers();
      if (!routeCoords || routeCoords.length < 2) return;

      var poly = L.polyline(routeCoords, {
        color: '#2563eb',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(routeLayer);

      if (fit) {
        map.fitBounds(poly.getBounds(), { padding: [50, 50] });
      }
    }

    function followPosition(lat, lng) {
      if (!map) return;
      map.panTo([lat, lng], { animate: true, duration: 0.5 });
    }

    function setCenter(lat, lng, zoom) {
      if (!map) return;
      map.setView([lat, lng], zoom || map.getZoom());
    }
  </script>
</body>
</html>
`;

export const LeafletMap: React.FC<LeafletMapProps> = ({
  center,
  zoom = 15,
  markers = [],
  route = null,
  onMapPress,
  fitToRoute = false,
  follow = null,
  style,
}) => {
  const webViewRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const WebViewComponent = WebView as any;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'map_press' && onMapPress) {
        onMapPress({ lat: data.lat, lng: data.lng });
      }
    } catch (e) {
      console.warn('Error parsing WebView message:', e);
    }
  };

  const onLoadEnd = () => {
    setIsLoaded(true);
    // Initialize map
    const initScript = `
      if (typeof initMap === 'function') {
        initMap(${center[0]}, ${center[1]}, ${zoom});
        updateMarkers(${JSON.stringify(markers)});
        updateRoute(${JSON.stringify(route || [])}, ${fitToRoute});
      }
      true;
    `;
    webViewRef.current?.injectJavaScript(initScript);
  };

  // Sync markers when updated
  useEffect(() => {
    if (!isLoaded) return;
    const script = `if (typeof updateMarkers === 'function') { updateMarkers(${JSON.stringify(markers)}); } true;`;
    webViewRef.current?.injectJavaScript(script);
  }, [markers, isLoaded]);

  // Sync route when updated
  useEffect(() => {
    if (!isLoaded) return;
    const script = `if (typeof updateRoute === 'function') { updateRoute(${JSON.stringify(route || [])}, ${fitToRoute}); } true;`;
    webViewRef.current?.injectJavaScript(script);
  }, [route, fitToRoute, isLoaded]);

  // Follow camera
  useEffect(() => {
    if (!isLoaded || !follow) return;
    const script = `if (typeof followPosition === 'function') { followPosition(${follow[0]}, ${follow[1]}); } true;`;
    webViewRef.current?.injectJavaScript(script);
  }, [follow, isLoaded]);

  return (
    <View style={[styles.container, style]}>
      <WebViewComponent
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: LEAFLET_HTML }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={handleMessage}
        onLoadEnd={onLoadEnd}
        style={styles.webview}
        scrollEnabled={false}
      />
      {!isLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0f172a',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
