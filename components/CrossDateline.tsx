"use client";

import React, { useEffect, useRef, useState } from "react";
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import Point from "ol/geom/Point";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { Translate } from "ol/interaction";
import { fromLonLat, toLonLat } from "ol/proj";
import { TranslateEvent } from "ol/interaction/Translate";
import { Coordinate } from "ol/coordinate";

const CrossDatelineMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const translateRef = useRef<Translate | null>(null);
  const ghostFeatureRef = useRef<Feature<LineString | MultiLineString> | null>(
    null
  );
  const [coordinates, setCoordinates] = useState<number[][]>([]);
  const [crossesDateline, setCrossesDateline] = useState<boolean>(false);

  // Function to check if a line segment crosses the dateline
  const crossesDatelineBetween = (lon1: number, lon2: number) => {
    const diff = Math.abs(lon1 - lon2);
    return diff > 180;
  };

  // Generate curved line between two points (great circle approximation)
  const generateCurvedLine = (
    start: number[],
    end: number[],
    numPoints: number = 20
  ): number[][] => {
    const [lon1, lat1] = start;
    const [lon2, lat2] = end;

    const points = [];

    // Handle dateline crossing for interpolation
    let actualLon2 = lon2;
    if (Math.abs(lon1 - lon2) > 180) {
      // Crossing dateline
      if (lon1 > lon2) {
        actualLon2 = lon2 + 360; // Going eastward across dateline
      } else {
        actualLon2 = lon2 - 360; // Going westward across dateline
      }
    }

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;

      // Linear interpolation with great circle approximation
      const lat = lat1 + (lat2 - lat1) * t;
      let lon = lon1 + (actualLon2 - lon1) * t;

      // Add some curvature (simple parabolic curve)
      const curvature = Math.sin(t * Math.PI) * 5; // 5 degrees max curvature
      const adjustedLat = lat + curvature;

      // Normalize longitude
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;

      points.push([lon, adjustedLat]);
    }

    return points;
  };

  // Function to split coordinates at dateline crossings
  const splitAtDateline = (coords: number[][]): number[][][] => {
    const segments = [];
    let currentSegment = [coords[0]];

    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];

      if (crossesDatelineBetween(prev[0], curr[0])) {
        // Crossing detected - split the segment
        const crossingLon = prev[0] > curr[0] ? 180 : -180;

        // Linear interpolation for latitude at crossing point
        const latDiff = curr[1] - prev[1];
        const lonDiff =
          curr[0] > prev[0]
            ? curr[0] - 360 - prev[0]
            : curr[0] - (prev[0] - 360);

        const ratio = Math.abs((crossingLon - prev[0]) / lonDiff);
        const crossingLat = prev[1] + latDiff * ratio;

        // Add crossing point to current segment
        currentSegment.push([crossingLon, crossingLat]);
        segments.push([...currentSegment]);

        // Start new segment from the other side of dateline
        const otherSideLon = crossingLon === 180 ? -180 : 180;
        currentSegment = [[otherSideLon, crossingLat], curr];
      } else {
        currentSegment.push(curr);
      }
    }

    if (currentSegment.length > 1) {
      segments.push(currentSegment);
    }

    return segments;
  };

  // Function to create geometry from coordinates
  const createGeometry = (coords: number[][]): LineString | MultiLineString => {
    const segments = splitAtDateline(coords);

    if (segments.length === 1) {
      return new LineString(
        segments[0].map((coord: number[]) => fromLonLat(coord))
      );
    } else {
      return new MultiLineString(
        segments.map((segment: number[][]) =>
          segment.map((coord: number[]) => fromLonLat(coord))
        )
      );
    }
  };

  // Create control points for start and end of route
  const createControlPoints = (
    start: number[],
    end: number[]
  ): Feature<Point>[] => {
    const startPoint = new Feature<Point>({
      geometry: new Point(fromLonLat(start)),
      name: "start",
    });

    const endPoint = new Feature<Point>({
      geometry: new Point(fromLonLat(end)),
      name: "end",
    });

    // Style for start point (green circle)
    startPoint.setStyle(
      new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({ color: "#10B981" }),
          stroke: new Stroke({ color: "#059669", width: 2 }),
        }),
      })
    );

    // Style for end point (red circle)
    endPoint.setStyle(
      new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({ color: "#EF4444" }),
          stroke: new Stroke({ color: "#DC2626", width: 2 }),
        }),
      })
    );

    return [startPoint, endPoint];
  };

  // Create ghost preview feature
  const createGhostFeature = (): Feature<LineString | MultiLineString> => {
    const ghostFeature = new Feature<LineString | MultiLineString>({
      name: "ghost-preview",
    });

    // Style for ghost preview (semi-transparent dashed line)
    ghostFeature.setStyle(
      new Style({
        stroke: new Stroke({
          color: "rgba(255, 107, 107, 0.5)",
          width: 3,
          lineDash: [10, 5],
        }),
      })
    );

    return ghostFeature;
  };

  // Function to update route based on control point positions
  const updateRoute = (startCoord: number[], endCoord: number[]): void => {
    if (mapInstanceRef.current) {
      const vectorLayer = mapInstanceRef.current
        .getLayers()
        .getArray()[1] as VectorLayer<VectorSource>;
      const vectorSource = vectorLayer.getSource()!;
      const features = vectorSource.getFeatures();

      // Find the line feature
      const lineFeature = features.find((f) => f.get("name") === "route-line");

      if (lineFeature) {
        const curvedCoords = generateCurvedLine(startCoord, endCoord, 25);
        const newGeometry = createGeometry(curvedCoords);
        (lineFeature as Feature<LineString | MultiLineString>).setGeometry(
          newGeometry
        );

        // Update display
        const displayCoords = curvedCoords.map((coord) => [
          parseFloat(coord[0].toFixed(4)),
          parseFloat(coord[1].toFixed(4)),
        ]);

        setCoordinates(displayCoords);

        // Check if it crosses dateline
        let crosses = false;
        for (let i = 1; i < displayCoords.length; i++) {
          if (
            crossesDatelineBetween(displayCoords[i - 1][0], displayCoords[i][0])
          ) {
            crosses = true;
            break;
          }
        }
        setCrossesDateline(crosses);
      }
    }
  };

  useEffect(() => {
    // Tokyo to LA curved route
    const tokyo = [139.6917, 35.6895];
    const la = [-118.2437, 34.0522];

    // Generate curved line (crosses dateline)
    const curvedCoords = generateCurvedLine(tokyo, la, 25);

    // Create geometry with proper dateline handling
    const geometry = createGeometry(curvedCoords);

    // Create the line feature
    const lineFeature = new Feature<LineString | MultiLineString>({
      geometry: geometry,
      name: "route-line",
    });

    // Style for the line
    const lineStyle = new Style({
      stroke: new Stroke({
        color: "#FF6B6B",
        width: 4,
      }),
    });

    lineFeature.setStyle(lineStyle);

    // Create control points
    const controlPoints = createControlPoints(tokyo, la);

    // Create ghost preview feature
    const ghostFeature = createGhostFeature();
    ghostFeatureRef.current = ghostFeature;

    // Vector source and layer
    const vectorSource = new VectorSource({
      features: [lineFeature, ...controlPoints, ghostFeature],
    });

    const vectorLayer = new VectorLayer({
      source: vectorSource,
    });

    // Create map
    const map = new Map({
      target: mapRef.current!,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
        vectorLayer,
      ],
      view: new View({
        center: fromLonLat([180, 40]),
        zoom: 3,
        projection: "EPSG:3857",
      }),
    });

    // Custom translate interaction for control points only
    const translate = new Translate({
      filter: (feature) => {
        const name = feature.get("name");
        return name === "start" || name === "end";
      },
    });

    map.addInteraction(translate);
    translateRef.current = translate;

    // Initial display
    const displayCoords = curvedCoords.map((coord) => [
      parseFloat(coord[0].toFixed(4)),
      parseFloat(coord[1].toFixed(4)),
    ]);
    setCoordinates(displayCoords);
    setCrossesDateline(true);

    // Handle translate events
    let isDragging = false;

    translate.on("translatestart", () => {
      isDragging = true;
    });

    translate.on("translating", (event: TranslateEvent) => {
      if (!isDragging) return;

      const features = vectorSource.getFeatures();
      const startPoint = features.find(
        (f) => f.get("name") === "start"
      ) as Feature<Point>;
      const endPoint = features.find(
        (f) => f.get("name") === "end"
      ) as Feature<Point>;

      if (startPoint && endPoint && ghostFeatureRef.current) {
        const startCoord = toLonLat(startPoint.getGeometry()!.getCoordinates());
        const endCoord = toLonLat(endPoint.getGeometry()!.getCoordinates());

        // Update ghost preview
        const curvedCoords = generateCurvedLine(startCoord, endCoord, 25);
        const ghostGeometry = createGeometry(curvedCoords);
        ghostFeatureRef.current.setGeometry(ghostGeometry);
      }
    });

    translate.on("translateend", (event: TranslateEvent) => {
      isDragging = false;

      const features = vectorSource.getFeatures();
      const startPoint = features.find(
        (f) => f.get("name") === "start"
      ) as Feature<Point>;
      const endPoint = features.find(
        (f) => f.get("name") === "end"
      ) as Feature<Point>;

      if (startPoint && endPoint) {
        const startCoord = toLonLat(startPoint.getGeometry()!.getCoordinates());
        const endCoord = toLonLat(endPoint.getGeometry()!.getCoordinates());

        updateRoute(startCoord, endCoord);

        // Clear ghost preview
        if (ghostFeatureRef.current) {
          ghostFeatureRef.current.setGeometry(undefined);
        }
      }
    });

    mapInstanceRef.current = map;

    return () => {
      map.setTarget(undefined);
    };
  }, []);

  const createTokyoLA = (): void => {
    if (mapInstanceRef.current) {
      const vectorLayer = mapInstanceRef.current
        .getLayers()
        .getArray()[1] as VectorLayer<VectorSource>;
      const vectorSource = vectorLayer.getSource()!;
      const features = vectorSource.getFeatures();

      const tokyo: number[] = [139.6917, 35.6895];
      const la: number[] = [-118.2437, 34.0522];

      // Update control points
      const startPoint = features.find(
        (f) => f.get("name") === "start"
      ) as Feature<Point>;
      const endPoint = features.find(
        (f) => f.get("name") === "end"
      ) as Feature<Point>;

      if (startPoint && endPoint) {
        startPoint.getGeometry()!.setCoordinates(fromLonLat(tokyo));
        endPoint.getGeometry()!.setCoordinates(fromLonLat(la));

        updateRoute(tokyo, la);
      }
    }
  };

  const createNYLondon = (): void => {
    if (mapInstanceRef.current) {
      const vectorLayer = mapInstanceRef.current
        .getLayers()
        .getArray()[1] as VectorLayer<VectorSource>;
      const vectorSource = vectorLayer.getSource()!;
      const features = vectorSource.getFeatures();

      const ny: number[] = [-74.006, 40.7128];
      const london: number[] = [-0.1276, 51.5074];

      // Update control points
      const startPoint = features.find(
        (f) => f.get("name") === "start"
      ) as Feature<Point>;
      const endPoint = features.find(
        (f) => f.get("name") === "end"
      ) as Feature<Point>;

      if (startPoint && endPoint) {
        startPoint.getGeometry()!.setCoordinates(fromLonLat(ny));
        endPoint.getGeometry()!.setCoordinates(fromLonLat(london));

        updateRoute(ny, london);
      }
    }
  };

  return (
    <div className="w-full h-screen flex flex-col bg-gray-100">
      <div className="bg-white shadow-sm border-b p-4">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          Cross-Dateline Flight Routes (Translate Control)
        </h1>
        <p className="text-gray-600 mb-4">
          Curved flight routes with translate control points. Drag the green
          (start) and red (end) circles to modify routes.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={createTokyoLA}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            Tokyo → LA (Crosses Dateline)
          </button>
          <button
            onClick={createNYLondon}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            NY → London (Atlantic)
          </button>
        </div>

        <div className="bg-gray-50 p-3 rounded border">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-gray-700">
              Route Points: {coordinates.length}
            </h3>
            <span
              className={`px-2 py-1 rounded text-sm font-semibold ${
                crossesDateline
                  ? "bg-red-100 text-red-700"
                  : "bg-green-100 text-green-700"
              }`}
            >
              {crossesDateline ? "CROSSES PACIFIC" : "STANDARD ROUTE"}
            </span>
          </div>
          <div className="text-sm font-mono text-gray-600 max-h-24 overflow-y-auto">
            Showing first 5 points:
            {coordinates.slice(0, 5).map((coord, index) => (
              <div key={index} className="mb-1">
                [{coord[0]}, {coord[1]}]
                {Math.abs(coord[0]) > 170 ? (
                  <span className="ml-2 text-orange-600 font-semibold">
                    (Dateline)
                  </span>
                ) : null}
              </div>
            ))}
            {coordinates.length > 5 && (
              <div className="text-gray-400">
                ... and {coordinates.length - 5} more points
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full" />

        <div className="absolute top-4 right-4 bg-white bg-opacity-95 p-3 rounded shadow-md text-sm max-w-xs">
          <h4 className="font-semibold mb-2">Control Points:</h4>
          <ul className="text-gray-600 space-y-1 text-xs">
            <li>
              •{" "}
              <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-1"></span>
              <span className="text-green-700 font-semibold">Green:</span> Start
              point (draggable)
            </li>
            <li>
              •{" "}
              <span className="inline-block w-3 h-3 bg-red-500 rounded-full mr-1"></span>
              <span className="text-red-700 font-semibold">Red:</span> End point
              (draggable)
            </li>
            <li>• Curved routes simulate great circle paths</li>
            <li>• Ghost preview shows route while dragging</li>
            <li>• Route updates automatically when points move</li>
            <li>• Automatic dateline splitting</li>
          </ul>
        </div>

        <div className="absolute bottom-4 left-4 bg-white bg-opacity-95 p-2 rounded shadow-md text-xs">
          <div className="font-semibold mb-1">Current Route:</div>
          <div className="text-gray-600">
            {crossesDateline
              ? "Trans-Pacific route crossing International Date Line"
              : "Standard route within single hemisphere"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrossDatelineMap;
