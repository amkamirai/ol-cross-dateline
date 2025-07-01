import { Geometry, LineString, MultiLineString } from "ol/geom";
import { fromLonLat, toLonLat } from "ol/proj";

// Function to check if a line segment crosses the dateline
export const crossesDatelineBetween = (lon1: number, lon2: number) => {
  const diff = Math.abs(lon1 - lon2);
  return diff > 180;
};

// Generate curved line between two points (great circle approximation)
export const generateCurvedLine = (
  start: [number, number],
  end: [number, number],
  numPoints = 20
) => {
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
export const splitAtDateline = (coords: [number, number][]) => {
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
        curr[0] > prev[0] ? curr[0] - 360 - prev[0] : curr[0] - (prev[0] - 360);

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
export const createGeometry = (coords: [number, number][]) => {
  const segments = splitAtDateline(coords);

  if (segments.length === 1) {
    return new LineString(segments[0].map((coord) => fromLonLat(coord)));
  } else {
    return new MultiLineString(
      segments.map((segment) => segment.map((coord) => fromLonLat(coord)))
    );
  }
};

// Function to extract coordinates from any geometry type
export const extractCoordinates = (geometry: LineString | MultiLineString) => {
  if (geometry instanceof MultiLineString) {
    const allCoords: [number, number][] = [];
    const lineStrings = geometry.getLineStrings();
    lineStrings.forEach((line, index) => {
      const coords = line.getCoordinates().map((coord) => toLonLat(coord)) as [
        number,
        number
      ][];
      if (index === 0) {
        allCoords.push(...coords);
      } else {
        // Skip the first point of subsequent segments (it's the dateline crossing point)
        allCoords.push(...coords.slice(1));
      }
    });
    return allCoords;
  } else {
    return geometry.getCoordinates().map((coord) => toLonLat(coord));
  }
};
