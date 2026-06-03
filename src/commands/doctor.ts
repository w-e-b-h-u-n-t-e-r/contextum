import pc from "picocolors";
import { detectRepo } from "../core/detect.js";
import { computeScore, resolveDetected } from "../core/score.js";
import { log } from "../core/log.js";

export interface DoctorOptions {
  root: string;
}

export async function doctor({ root }: DoctorOptions): Promise<void> {
  const [profile, score] = await Promise.all([
    detectRepo(root),
    computeScore(root),
  ]);

  log.title("Contextum Doctor");

  console.log("");
  printMetric("Structure readiness", score.structureReadiness);
  printMetric("Context quality", score.contextQuality);
  printMetric("Agent readiness", score.agentReadiness);
  console.log(`Trust state: ${pc.bold(score.trustState)}`);
  console.log("");

  if (score.missing.length) {
    console.log(pc.bold("Missing context files:"));
    for (const file of score.missing) console.log(`  ${pc.red("-")} ${file}`);
    console.log("");
  }

  if (score.missingAgentFiles.length) {
    console.log(pc.bold("Missing agent files:"));
    for (const file of score.missingAgentFiles) console.log(`  ${pc.red("-")} ${file}`);
    console.log("");
  }

  if (score.weak.length) {
    console.log(pc.bold("Weak context files (TODO/UNKNOWN present):"));
    for (const file of score.weak) console.log(`  ${pc.yellow("~")} ${file}`);
    console.log("");
  }

  if (score.recommendedActions.length) {
    console.log(pc.bold("Recommended next actions:"));
    for (const action of score.recommendedActions) {
      console.log(`  ${pc.cyan("-")} ${action}`);
    }
    console.log("");
  }

  const detected = await resolveDetected(root, profile);
  console.log(pc.bold("Detected:"));
  for (const [key, value] of Object.entries(detected)) {
    console.log(`  ${pc.dim("•")} ${key}: ${value}`);
  }
  console.log("");

  if (
    score.structureReadiness === 100 &&
    score.contextQuality >= 80 &&
    score.agentReadiness === 100 &&
    score.trustState !== "auto_generated"
  ) {
    log.ok("Context layer is structurally complete, agent-ready, and reviewed.");
  } else {
    log.dim("Contextum separates structure from trust. Presence of files is not proof of context quality.");
  }
}

function printMetric(label: string, value: number): void {
  const tint = value >= 75 ? pc.green : value >= 40 ? pc.yellow : pc.red;
  console.log(`${label}: ${tint(pc.bold(`${value}%`))}`);
}
