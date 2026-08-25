import type { BoundingBox } from "./bbox.js";
import { getApproximateAreaKm2, isBoundingBox } from "./bbox.js";
import type {
  MapPoint as NetworkMapPoint,
  NetworkOsmRoad,
  NetworkProposal
} from "../../shared/network-analysis.js";
import {
  analyzeCombinedTransportNetwork,
  buildCombinedNetworkGraphs
} from "../../shared/network-analysis.js";
import { analyzePedestrianAccessibility } from "../../shared/pedestrian-analysis.js";

type MapPoint = {
  lat: number;
  lng: number;
};

type OsmFeature = {
  id: number;
  kind: string;
  tags?: Record<string, string>;
  geometry: MapPoint[];
};

type OsmData = {
  bbox: BoundingBox;
  counts: {
    buildings: number;
    roads: number;
    openLand: number;
  };
  buildings: OsmFeature[];
  roads: OsmFeature[];
  openLand: OsmFeature[];
};

type DrawingObject =
  | {
      id: string;
      type: "road" | "bike" | "sidewalk";
      path: MapPoint[];
      snapped: boolean;
    }
  | {
      id: string;
      type: "crossing";
      anchor: MapPoint;
      pixelVector: {
        x: number;
        y: number;
      };
    }
  | {
      center: MapPoint;
      id: string;
      pixelRadius: number;
      type: "roundabout";
    }
  | {
      id: string;
      point: MapPoint;
      type: "signal";
    };

type AnalysisInput = {
  bbox: BoundingBox;
  osmData: OsmData;
  projectName?: string;
  userEdits: DrawingObject[];
};

export type ChangeAnalysis = {
  disclaimer: string;
  pedestrianImpact: string[];
  provider: "rules";
  safetyObservations: string[];
  suggestions: string[];
  summary: string;
};

export function analyzeProjectChanges(input: unknown): ChangeAnalysis {
  const project = parseAnalysisInput(input);
  const counts = countUserEdits(project.userEdits);
  const roadCount = project.osmData.counts.roads;
  const totalEdits = project.userEdits.length;
  const provider = getAnalysisProvider();

  if (provider !== "rules") {
    throw new Error(`AI_ANALYSIS_PROVIDER=${provider} is not implemented yet. Use "rules" for the free local analyzer.`);
  }

  return {
    disclaimer: "Rule-based guidance only. This is not AI-generated engineering advice or a traffic simulation.",
    provider: "rules",
    summary: getSummary(project.projectName, totalEdits, counts, roadCount),
    safetyObservations: getSafetyObservations(counts, roadCount),
    pedestrianImpact: [
      ...getPedestrianImpact(counts, roadCount),
      ...getPedestrianNetworkFindings(project.osmData.roads, project.userEdits)
    ],
    suggestions: getSuggestions(counts, roadCount, project.bbox)
  };
}

/**
 * Runs the shared pedestrian/accessibility heuristics (Task 22) over the
 * combined existing-plus-proposed network and turns findings into readable
 * impact lines. Failures never break the analysis endpoint.
 */
function getPedestrianNetworkFindings(
  roads: OsmFeature[],
  userEdits: DrawingObject[]
): string[] {
  try {
    const osmRoads: NetworkOsmRoad[] = roads.map((road) => ({
      id: road.id,
      kind: road.kind,
      geometry: road.geometry as NetworkMapPoint[],
      tags: road.tags
    }));
    const proposals: NetworkProposal[] = [];
    for (const edit of userEdits) {
      if ((edit.type === "road" || edit.type === "bike" || edit.type === "sidewalk") && Array.isArray(edit.path)) {
        if (edit.path.length < 2) continue;
        proposals.push({
          id: edit.id,
          kind: edit.type === "sidewalk" ? "footpath" : edit.type === "bike" ? "cycleway" : "road",
          points: edit.path as NetworkMapPoint[]
        });
      } else if (edit.type === "crossing") {
        proposals.push({ id: edit.id, point: edit.anchor as NetworkMapPoint });
      }
    }

    const graphs = buildCombinedNetworkGraphs(osmRoads, proposals);
    const pedestrian = analyzePedestrianAccessibility(graphs);
    const findings: string[] = [];

    if (pedestrian.gaps.length > 0) {
      findings.push(
        `Heuristic: ${pedestrian.gaps.length} sidewalk gap${pedestrian.gaps.length === 1 ? "" : "s"} detected in the walking network (${pedestrian.junctionDiscontinuities} near junctions).`
      );
    }

    if (pedestrian.isolatedFootpaths.length > 0) {
      findings.push(
        `Heuristic: ${pedestrian.isolatedFootpaths.length} isolated footpath segment${pedestrian.isolatedFootpaths.length === 1 ? "" : "s"} do${pedestrian.isolatedFootpaths.length === 1 ? "es" : ""} not connect to the main walkable network.`
      );
    }

    if (pedestrian.missingCurbConnections > 0) {
      findings.push(
        `Heuristic: ${pedestrian.missingCurbConnections} walkable dead-end${pedestrian.missingCurbConnections === 1 ? " lacks" : "s lack"} a curb or access connection to a road.`
      );
    }

    if (pedestrian.excessiveCrossingDistances.length > 0) {
      findings.push(
        `Heuristic: ${pedestrian.excessiveCrossingDistances.length} long stretch${pedestrian.excessiveCrossingDistances.length === 1 ? "" : "es"} without footways or crossing opportunities; consider adding crossings.`
      );
    }

    findings.push(
      `Heuristic sidewalk coverage: ${pedestrian.sidewalk.coveragePercent}% of the modeled network length is walkable.`
    );

    return findings;
  } catch {
    return [];
  }
}

function getAnalysisProvider() {
  return (process.env.AI_ANALYSIS_PROVIDER ?? "rules").toLowerCase();
}

function countUserEdits(objects: DrawingObject[]) {
  return objects.reduce(
    (counts, object) => ({
      ...counts,
      [object.type]: counts[object.type] + 1
    }),
    {
      bike: 0,
      crossing: 0,
      road: 0,
      roundabout: 0,
      sidewalk: 0,
      signal: 0
    }
  );
}

function getSummary(
  projectName: string | undefined,
  totalEdits: number,
  counts: ReturnType<typeof countUserEdits>,
  roadCount: number
) {
  const name = projectName?.trim() || "This project";

  if (totalEdits === 0) {
    return `${name} has no proposed edits yet. The selected area includes ${roadCount} OSM road features, so analysis is limited to existing map context.`;
  }

  const parts = [
    describeCount(counts.sidewalk, "sidewalk"),
    describeCount(counts.bike, "bike lane"),
    describeCount(counts.crossing, "crossing"),
    describeCount(counts.signal, "traffic signal"),
    describeCount(counts.roundabout, "roundabout"),
    describeCount(counts.road, "road or lane")
  ].filter(Boolean);

  return `${name} adds ${parts.join(", ")} across an area with ${roadCount} OSM road features.`;
}

function getSafetyObservations(counts: ReturnType<typeof countUserEdits>, roadCount: number) {
  const observations: string[] = [];

  if (counts.crossing > 0) {
    observations.push("New crossings can improve pedestrian visibility, especially when placed near intersections or desire lines.");
  }

  if (counts.signal > 0) {
    observations.push("Traffic signals may reduce conflict at busy junctions, but they should be checked against vehicle speeds, turning movements, and pedestrian demand.");
  }

  if (counts.roundabout > 0) {
    observations.push("Roundabouts can calm speeds, but pedestrian crossings and splitter islands matter for safe access around them.");
  }

  if (counts.bike > 0) {
    observations.push("Bike lanes add a clear cycling space; protection or buffers would be important on faster or busier streets.");
  }

  if (counts.crossing === 0 && (counts.sidewalk > 0 || counts.bike > 0) && roadCount > 10) {
    observations.push("The proposal adds linear facilities but no crossings; check whether people can safely cross major road segments.");
  }

  return observations.length > 0
    ? observations
    : ["No major safety signal is obvious from the current edits. Add crossings, signals, or traffic-calming elements to support stronger safety changes."];
}

function getPedestrianImpact(counts: ReturnType<typeof countUserEdits>, roadCount: number) {
  const impact: string[] = [];

  if (counts.sidewalk > 0) {
    impact.push("Added sidewalks should improve pedestrian continuity along the edited streets.");
  }

  if (counts.crossing > 0) {
    impact.push("Added crossings should improve network permeability by making it easier to move across roads.");
  }

  if (counts.signal > 0) {
    impact.push("Signals can create more predictable pedestrian crossing phases if they are coordinated with marked crossings.");
  }

  if (counts.sidewalk === 0 && counts.crossing === 0 && roadCount > 0) {
    impact.push("Pedestrian impact appears limited because no sidewalks or crossings were added.");
  }

  return impact;
}

function getSuggestions(counts: ReturnType<typeof countUserEdits>, roadCount: number, bbox: BoundingBox) {
  const suggestions: string[] = [];
  const areaKm2 = getApproximateAreaKm2(bbox);

  if (counts.sidewalk > 0 && counts.crossing === 0) {
    suggestions.push("Add crossings at the ends of new sidewalk segments so the pedestrian route connects across the street network.");
  }

  if (counts.bike > 0 && counts.signal === 0 && counts.crossing === 0) {
    suggestions.push("Check conflict points for cyclists and consider adding crossings, signals, or protected transitions at intersections.");
  }

  if (counts.roundabout > 0) {
    suggestions.push("Place crossings slightly away from roundabout entries and exits, where drivers have more time to yield.");
  }

  if (roadCount > 40 && counts.sidewalk < 2) {
    suggestions.push("This selected area has many roads; consider adding more sidewalk coverage before evaluating broader walkability.");
  }

  if (areaKm2 > 2) {
    suggestions.push("For sharper feedback, analyze a smaller neighborhood-sized box so the edits are not diluted by unrelated roads.");
  }

  return suggestions.length > 0 ? suggestions : ["Add one or two targeted pedestrian or cycling improvements, then re-run analysis for more specific feedback."];
}

function describeCount(count: number, label: string) {
  if (count === 0) {
    return "";
  }

  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

const maxProjectNameLength = 80;
const maxAnalysisEdits = 10_000;

function parseAnalysisInput(input: unknown): AnalysisInput {
  if (!input || typeof input !== "object") {
    throw new Error("Request body must be an object.");
  }

  const body = input as Record<string, unknown>;

  if (!isBoundingBox(body.bbox)) {
    throw new Error("Analysis bbox must include north, south, east, and west numbers.");
  }

  if (!isOsmData(body.osmData)) {
    throw new Error("Analysis osmData is required.");
  }

  if (!Array.isArray(body.userEdits)) {
    throw new Error("Analysis userEdits must be an array.");
  }

  if (body.userEdits.length > maxAnalysisEdits) {
    throw new Error(`Analysis supports at most ${maxAnalysisEdits.toLocaleString("en-US")} drawing edits.`);
  }

  let projectName: string | undefined;

  if (typeof body.projectName === "string") {
    projectName = body.projectName.trim().slice(0, maxProjectNameLength);

    if (projectName.length === 0) {
      projectName = undefined;
    }
  }

  return {
    bbox: body.bbox,
    osmData: body.osmData,
    projectName,
    userEdits: body.userEdits.filter(isDrawingObject)
  };
}

function isOsmData(value: unknown): value is OsmData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Partial<OsmData>;

  if (!data.counts || !Array.isArray(data.roads) || !Array.isArray(data.buildings) || !Array.isArray(data.openLand)) {
    return false;
  }

  // NaN/negative/garbage counts would leak into generated analysis text.
  const counts = data.counts as Partial<OsmData["counts"]>;

  return (
    Number.isFinite(counts.roads) && (counts.roads as number) >= 0 &&
    Number.isFinite(counts.buildings) && (counts.buildings as number) >= 0 &&
    Number.isFinite(counts.openLand) && (isNonNegativeFinite(counts.openLand))
  );
}

function isNonNegativeFinite(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) >= 0;
}

function isDrawingObject(value: unknown): value is DrawingObject {
  if (!value || typeof value !== "object") {
    return false;
  }

  const object = value as Partial<DrawingObject>;

  return typeof object.id === "string" && typeof object.type === "string";
}
