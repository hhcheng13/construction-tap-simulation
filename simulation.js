export const TRADES = [
  { id: "excavation", name: "Structural Frame", team: 1, units: 85, baseProductivity: 1.18, plannedDurationFactor: 1.5, outdoor: true, robotBoost: false, color: "#8c5a2b" },
  { id: "foundation", name: "Floor Deck", team: 2, units: 110, baseProductivity: 1.02, plannedDurationFactor: 1.15, outdoor: true, robotBoost: false, color: "#556b78" },
  { id: "structure", name: "Facade & Windows", team: 3, units: 125, baseProductivity: 0.94, plannedDurationFactor: 1.1, outdoor: true, robotBoost: true, color: "#2f6cab" },
  { id: "envelope", name: "MEP Rough-In", team: 4, units: 95, baseProductivity: 1.03, plannedDurationFactor: 1.2, outdoor: false, robotBoost: true, color: "#d97706" },
  { id: "mep", name: "Interior Finish", team: 5, units: 145, baseProductivity: 0.84, plannedDurationFactor: 1.35, outdoor: false, robotBoost: false, color: "#0f766e" }
];

export const FLOORS = 3;
export const GAME_PATH = "games/live";
export const STATUS = {
  WAITING: "Waiting for lecturer",
  READY: "Ready",
  WORKING: "Working",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  PAUSED: "Paused"
};

const HISTORY_LIMIT = 240;
const ROBOT_MULTIPLIER = 1.5;
export const AUTO_PROGRESS_INTERVAL_MS = 1000;
const AUTO_PROGRESS_RATIO = 1;
const TAP_PROGRESS_RATIO = 0.052;
const DEFAULT_PLANNED_PRODUCTIVITY_FACTOR = 10;
const FLOOR_LEARNING_REDUCTION = [1, 0.94, 0.88, 0.84, 0.8];
const TEAM_LEARNING_MAX_BOOST = 1.3;
const TEAM_LEARNING_WORK_SPAN = 240;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function sampleAutoProgressFactor() {
  return round(0.9 + Math.random() * 0.12);
}

function taskId(tradeId, floor) {
  return `${tradeId}-F${floor}`;
}

function getPlannedDurationTicks(task) {
  return Math.max(1, (task.plannedFinishTick || 1) - (task.plannedStartTick || 0));
}

function getPlannedWorkPerTick(task) {
  return task.required / getPlannedDurationTicks(task);
}

function getPlannedProductivityFactor(source) {
  const value = Number(source?.controls?.plannedProductivityFactor ?? source?.plannedProductivityFactor);
  return clamp(Number.isFinite(value) ? value : DEFAULT_PLANNED_PRODUCTIVITY_FACTOR, 0.2, 500);
}

function getPlannedDuration(trade, floor, productivityFactor = DEFAULT_PLANNED_PRODUCTIVITY_FACTOR) {
  const floorIndex = Math.max(0, floor - 1);
  const learningFactor = FLOOR_LEARNING_REDUCTION[floorIndex] ?? FLOOR_LEARNING_REDUCTION.at(-1) ?? 0.8;
  const baseDuration = trade.units / (trade.baseProductivity * productivityFactor);
  return Math.max(
    12,
    Math.ceil(baseDuration * (trade.plannedDurationFactor || 1) * learningFactor)
  );
}

function buildPlannedWindows(source) {
  const productivityFactor = getPlannedProductivityFactor(source);
  const plannedWindows = {};
  const plannedDurationsByTrade = {};

  TRADES.forEach((trade) => {
    plannedDurationsByTrade[trade.id] = [];
    for (let floor = 1; floor <= FLOORS; floor += 1) {
      const proposedDuration = getPlannedDuration(trade, floor, productivityFactor);
      const previousDuration = plannedDurationsByTrade[trade.id][floor - 2];
      const safeDuration = previousDuration
        ? Math.min(previousDuration, proposedDuration)
        : proposedDuration;
      plannedDurationsByTrade[trade.id].push(safeDuration);
    }
  });

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade, index) => {
      const id = taskId(trade.id, floor);
      const previousFloorId = floor > 1 ? taskId(trade.id, floor - 1) : null;
      const predecessorId = index > 0 ? taskId(TRADES[index - 1].id, floor) : null;
      const previousFloorFinish = previousFloorId ? plannedWindows[previousFloorId].finish : 0;
      const predecessorFinish = predecessorId ? plannedWindows[predecessorId].finish : 0;
      const start = Math.max(previousFloorFinish, predecessorFinish);
      const duration = plannedDurationsByTrade[trade.id][floor - 1];

      plannedWindows[id] = {
        start,
        finish: start + duration
      };
    });
  }

  return plannedWindows;
}

function makeTeamState(trade) {
  return {
    team: trade.team,
    tradeId: trade.id,
    tradeName: trade.name,
    taps: 0,
    validTaps: 0,
    effectiveWork: 0,
    fatigueLevel: 0,
    lastTapTick: null,
    currentTaskId: taskId(trade.id, 1),
    currentFloor: 1,
    currentActivity: `${trade.name} Floor 1`,
    progressPct: 0,
    productivityMultiplier: 1,
    variabilityMultiplier: 1,
    learningMultiplier: 1,
    robotMultiplier: 1,
    fatigueMultiplier: 1,
    status: STATUS.WAITING
  };
}

function makeTask(trade, floor, plannedStart, plannedDuration) {
  return {
    id: taskId(trade.id, floor),
    floor,
    tradeId: trade.id,
    tradeName: trade.name,
    team: trade.team,
    required: trade.units,
    done: 0,
    status: "blocked",
    startTick: null,
    finishTick: null,
    plannedStartTick: plannedStart,
    plannedFinishTick: plannedStart + plannedDuration,
    latestWork: 0,
    autoProgressFactor: sampleAutoProgressFactor()
  };
}

export function makeInitialState() {
  const tasks = {};
  const teams = {};
  const controls = {
    fatigueEnabled: true,
    learningEnabled: false,
    robotEnabled: false,
    plannedProductivityFactor: DEFAULT_PLANNED_PRODUCTIVITY_FACTOR
  };
  const plannedWindows = buildPlannedWindows({ controls });

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade) => {
      const plannedWindow = plannedWindows[taskId(trade.id, floor)];
      const plannedStart = plannedWindow?.start ?? 0;
      const plannedFinish = plannedWindow?.finish ?? plannedStart + 1;
      tasks[taskId(trade.id, floor)] = {
        ...makeTask(trade, floor, plannedStart, plannedFinish - plannedStart),
        plannedStartTick: plannedStart,
        plannedFinishTick: plannedFinish
      };
    });
  }

  TRADES.forEach((trade) => {
    teams[trade.team] = makeTeamState(trade);
  });

  const state = {
    initializedAt: Date.now(),
    running: false,
    tick: 0,
    startedAt: null,
    lastAutoProgressAt: null,
    controls,
    environment: {
      learningActive: false,
      robotAssistanceActive: false
    },
    teams,
    tasks,
    history: [
      {
        tick: 0,
        overallProgress: 0,
        completedTasks: 0,
        workingCrews: 0,
        blockedCrews: TRADES.length,
        activeFloor: 1
      }
    ],
    events: [
      {
        tick: 0,
        type: "system",
        message: "Simulation initialized"
      }
    ],
    uiMessage: "Simulation initialized"
  };

  updateStatuses(state);
  return state;
}

function getTradeByTeam(teamNumber) {
  return TRADES.find((trade) => trade.team === Number(teamNumber)) || null;
}

function getTradeById(tradeId) {
  return TRADES.find((trade) => trade.id === tradeId) || null;
}

function calculateFatigueMultiplier(teamState, controls) {
  if (!controls?.fatigueEnabled) {
    return 1;
  }
  const sustained = Math.max(0, (teamState?.validTaps || 0) - 3);
  return clamp(1 - sustained * 0.012, 0.62, 1);
}

function calculateLearningMultiplier(teamState, controls, environment) {
  if (!controls?.learningEnabled && !environment?.learningActive) {
    return 1;
  }
  const effectiveWork = Math.max(0, Number(teamState?.effectiveWork) || 0);
  const learningProgress = clamp(effectiveWork / TEAM_LEARNING_WORK_SPAN, 0, 1);
  return round(1 + (TEAM_LEARNING_MAX_BOOST - 1) * learningProgress);
}

function calculateRobotMultiplier(trade, environment) {
  if (!environment?.robotAssistanceActive || !trade?.robotBoost) {
    return 1;
  }
  return ROBOT_MULTIPLIER;
}

function getProgressPct(task) {
  if (!task?.required) {
    return 0;
  }
  return Math.round((clamp(task.done, 0, task.required) / task.required) * 100);
}

export function overallProgress(state) {
  const tasks = Object.values(state?.tasks || {});
  const required = tasks.reduce((sum, task) => sum + (Number(task.required) || 0), 0);
  const done = tasks.reduce((sum, task) => sum + clamp(Number(task.done) || 0, 0, Number(task.required) || 0), 0);
  return required ? done / required : 0;
}

function calculatePhaseMultiplier(state) {
  const progress = overallProgress(state);
  const bellCurve = 1 - Math.pow((progress - 0.5) / 0.5, 2);
  return round(clamp(0.6 + bellCurve * 0.42, 0.6, 1.02));
}

export function getCompletedTasksCount(state) {
  return Object.values(state?.tasks || {}).filter((task) => task.done >= task.required).length;
}

function isProjectComplete(state) {
  return getCompletedTasksCount(state) >= TRADES.length * FLOORS;
}

export function getActiveFloor(state) {
  const tasks = Object.values(state?.tasks || {});
  const unfinished = tasks
    .filter((task) => task.done < task.required)
    .sort((a, b) => a.floor - b.floor || a.team - b.team);
  return unfinished[0]?.floor || FLOORS;
}

export function isEligible(state, task) {
  if (!state || !task || task.done >= task.required) {
    return false;
  }

  const tradeIndex = TRADES.findIndex((trade) => trade.id === task.tradeId);
  if (tradeIndex === -1) {
    return false;
  }

  if (task.floor > 1) {
    const previousFloorTask = state.tasks?.[taskId(task.tradeId, task.floor - 1)];
    if (!previousFloorTask || previousFloorTask.done < previousFloorTask.required) {
      return false;
    }
  }

  if (tradeIndex > 0) {
    const predecessorTrade = TRADES[tradeIndex - 1];
    const predecessorTask = state.tasks?.[taskId(predecessorTrade.id, task.floor)];
    if (!predecessorTask || predecessorTask.done < predecessorTask.required) {
      return false;
    }
    if (!Number.isFinite(predecessorTask.finishTick) || predecessorTask.finishTick >= state.tick) {
      return false;
    }
  }

  return true;
}

function getCandidateTask(state, teamNumber) {
  return Object.values(state?.tasks || {})
    .filter((task) => task.team === Number(teamNumber) && isEligible(state, task))
    .sort((a, b) => a.floor - b.floor)[0] || null;
}

function getFallbackTask(state, teamNumber) {
  return Object.values(state?.tasks || {})
    .filter((task) => task.team === Number(teamNumber) && task.done < task.required)
    .sort((a, b) => a.floor - b.floor)[0] || null;
}

function summarizeTeamStatus(state, teamNumber, candidate) {
  if (!state) {
    return STATUS.WAITING;
  }
  if (!state.running) {
    return state.tick > 0 ? STATUS.PAUSED : STATUS.WAITING;
  }
  if (candidate) {
    return candidate.done > 0 ? STATUS.WORKING : STATUS.READY;
  }
  const fallback = getFallbackTask(state, teamNumber);
  return fallback ? STATUS.BLOCKED : STATUS.COMPLETED;
}

function appendEvent(state, type, message, payload = {}) {
  state.events ||= [];
  state.events.push({
    tick: state.tick || 0,
    type,
    message,
    ...payload
  });
  if (state.events.length > HISTORY_LIMIT) {
    state.events = state.events.slice(-HISTORY_LIMIT);
  }
}

function appendHistory(state) {
  const snapshot = {
    tick: state.tick || 0,
    overallProgress: round(overallProgress(state) * 100),
    completedTasks: getCompletedTasksCount(state),
    workingCrews: Object.values(state.teams || {}).filter((team) => team.status === STATUS.WORKING).length,
    blockedCrews: Object.values(state.teams || {}).filter((team) => team.status === STATUS.BLOCKED).length,
    activeFloor: getActiveFloor(state)
  };
  const history = state.history || [];
  const last = history[history.length - 1];
  if (!last || last.tick !== snapshot.tick || last.overallProgress !== snapshot.overallProgress) {
    history.push(snapshot);
  } else {
    history[history.length - 1] = snapshot;
  }
  state.history = history.slice(-HISTORY_LIMIT);
}

export function getTotalRequiredUnits() {
  return TRADES.reduce((sum, trade) => sum + trade.units, 0) * FLOORS;
}

export function getTaskPlannedPoints(state) {
  const safeState = sanitizeState(state);
  const tasks = Object.values(safeState.tasks);
  const totalRequired = getTotalRequiredUnits();
  const maxTick = Math.max(...tasks.map((task) => task.plannedFinishTick), 1);

  return Array.from({ length: maxTick + 1 }, (_, tick) => {
    const completedUnits = tasks.reduce((sum, task) => {
      if (tick <= task.plannedStartTick) {
        return sum;
      }
      if (tick >= task.plannedFinishTick) {
        return sum + task.required;
      }
      const span = Math.max(1, task.plannedFinishTick - task.plannedStartTick);
      const portion = (tick - task.plannedStartTick) / span;
      return sum + task.required * portion;
    }, 0);

    return {
      x: tick,
      y: round((completedUnits / totalRequired) * 100)
    };
  });
}

function normalizeTask(rawTask, trade, floor, controls) {
  const plannedWindows = buildPlannedWindows({ controls });
  const plannedWindow = plannedWindows[taskId(trade.id, floor)];
  const fallbackPlannedStart = plannedWindow?.start ?? 0;
  const plannedDuration = Math.max(1, (plannedWindow?.finish ?? 1) - fallbackPlannedStart);
  const safeTask = {
    ...makeTask(trade, floor, fallbackPlannedStart, plannedDuration),
    ...(rawTask || {})
  };
  safeTask.team = trade.team;
  safeTask.tradeId = trade.id;
  safeTask.tradeName = trade.name;
  safeTask.floor = floor;
  safeTask.required = Number.isFinite(Number(safeTask.required)) ? Number(safeTask.required) : trade.units;
  safeTask.done = clamp(Number(safeTask.done) || 0, 0, safeTask.required);
  safeTask.startTick = safeTask.startTick !== null
    && safeTask.startTick !== undefined
    && Number.isFinite(Number(safeTask.startTick))
    && Number(safeTask.startTick) >= 0
    ? Number(safeTask.startTick)
    : null;
  safeTask.finishTick = safeTask.finishTick !== null
    && safeTask.finishTick !== undefined
    && Number.isFinite(Number(safeTask.finishTick))
    && Number(safeTask.finishTick) >= 0
    ? Number(safeTask.finishTick)
    : null;
  safeTask.plannedStartTick = Number.isFinite(Number(safeTask.plannedStartTick)) ? Number(safeTask.plannedStartTick) : safeTask.plannedStartTick;
  safeTask.plannedFinishTick = Number.isFinite(Number(safeTask.plannedFinishTick)) ? Number(safeTask.plannedFinishTick) : safeTask.plannedFinishTick;
  safeTask.latestWork = round(Number(safeTask.latestWork) || 0);
  safeTask.autoProgressFactor = Number.isFinite(Number(safeTask.autoProgressFactor))
    ? clamp(Number(safeTask.autoProgressFactor), 0.5, 1.5)
    : sampleAutoProgressFactor();
  return safeTask;
}

function reapplyPlannedWindows(state) {
  const plannedWindows = buildPlannedWindows(state);
  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade) => {
      const id = taskId(trade.id, floor);
      const task = state.tasks?.[id];
      const window = plannedWindows[id];
      if (!task || !window) {
        return;
      }
      task.plannedStartTick = window.start;
      task.plannedFinishTick = window.finish;
    });
  }
}

export function sanitizeState(rawState) {
  const fallback = makeInitialState();
  if (!rawState || typeof rawState !== "object") {
    return fallback;
  }

  const safeState = {
    ...fallback,
    ...rawState,
    controls: {
      ...fallback.controls,
      ...(rawState.controls || {})
    },
    environment: {
      ...fallback.environment,
      ...(rawState.environment || {})
    },
    teams: {},
    tasks: {},
    history: Array.isArray(rawState.history) ? rawState.history.filter((item) => item && Number.isFinite(Number(item.tick))).slice(-HISTORY_LIMIT) : fallback.history,
    events: Array.isArray(rawState.events) ? rawState.events.slice(-HISTORY_LIMIT) : fallback.events
  };

  safeState.running = Boolean(rawState.running);
  safeState.tick = Number.isFinite(Number(rawState.tick)) ? Number(rawState.tick) : 0;
  safeState.startedAt = rawState.startedAt || null;
  safeState.initializedAt = rawState.initializedAt || fallback.initializedAt;
  safeState.lastAutoProgressAt = Number.isFinite(Number(rawState.lastAutoProgressAt))
    ? Number(rawState.lastAutoProgressAt)
    : null;
  if (!safeState.controls.learningEnabled && safeState.controls.rainEnabled) {
    safeState.controls.learningEnabled = Boolean(safeState.controls.rainEnabled);
  }
  if (!safeState.environment.learningActive && safeState.environment.rainActive) {
    safeState.environment.learningActive = Boolean(safeState.environment.rainActive);
  }
  safeState.controls.plannedProductivityFactor = getPlannedProductivityFactor(safeState);

  TRADES.forEach((trade) => {
    const rawTeam = rawState.teams?.[trade.team] || rawState.teams?.[String(trade.team)] || {};
    safeState.teams[trade.team] = {
      ...makeTeamState(trade),
      ...rawTeam,
      team: trade.team,
      tradeId: trade.id,
      tradeName: trade.name,
      taps: Math.max(0, Number(rawTeam.taps) || 0),
      validTaps: Math.max(0, Number(rawTeam.validTaps) || 0),
      effectiveWork: round(Math.max(0, Number(rawTeam.effectiveWork) || 0)),
      fatigueLevel: round(Math.max(0, Number(rawTeam.fatigueLevel) || 0))
    };
  });

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade) => {
      const id = taskId(trade.id, floor);
      safeState.tasks[id] = normalizeTask(rawState.tasks?.[id], trade, floor, safeState.controls);
    });
  }

  updateStatuses(safeState);
  appendHistory(safeState);
  return safeState;
}

export function updateStatuses(state) {
  Object.values(state.tasks || {}).forEach((task) => {
    if (task.done >= task.required) {
      task.status = "complete";
      if (task.finishTick === null) {
        task.finishTick = state.tick || 0;
      }
      return;
    }
    task.status = isEligible(state, task) ? (task.done > 0 ? "active" : "ready") : "blocked";
  });

  TRADES.forEach((trade) => {
    const team = state.teams[trade.team];
    const candidate = getCandidateTask(state, trade.team);
    const fallback = candidate || getFallbackTask(state, trade.team);
    const fatigueMultiplier = calculateFatigueMultiplier(team, state.controls);
    const learningMultiplier = calculateLearningMultiplier(team, state.controls, state.environment);
    const robotMultiplier = calculateRobotMultiplier(trade, state.environment);
    const productivityMultiplier = round(fatigueMultiplier * learningMultiplier * robotMultiplier * (team.variabilityMultiplier || 1));
    const task = fallback;

    team.currentTaskId = task?.id || null;
    team.currentFloor = task?.floor || FLOORS;
    team.currentActivity = task ? `${task.tradeName} Floor ${task.floor}` : `${trade.name} complete`;
    team.progressPct = task ? getProgressPct(task) : 100;
    team.fatigueMultiplier = round(fatigueMultiplier);
    team.learningMultiplier = round(learningMultiplier);
    team.robotMultiplier = round(robotMultiplier);
    team.productivityMultiplier = round(productivityMultiplier);
    team.status = summarizeTeamStatus(state, trade.team, candidate);
  });

  state.uiMessage = isProjectComplete(state)
    ? "Simulation complete"
    : state.running
      ? "Simulation running"
      : state.tick > 0
        ? "Simulation paused"
        : "Waiting for lecturer";
}

export function applyControlToggle(rawState, controlKey, active) {
  const state = sanitizeState(rawState);
  if (controlKey === "fatigueEnabled") {
    state.controls.fatigueEnabled = Boolean(active);
  }
  if (controlKey === "learningEnabled" || controlKey === "rainEnabled") {
    state.controls.learningEnabled = Boolean(active);
    state.environment.learningActive = Boolean(active);
  }
  if (controlKey === "robotEnabled") {
    state.controls.robotEnabled = Boolean(active);
    state.environment.robotAssistanceActive = Boolean(active);
  }
  appendEvent(state, "control", `${controlKey} ${active ? "enabled" : "disabled"}`);
  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function setPlannedProductivityFactor(rawState, factor) {
  const state = sanitizeState(rawState);
  state.controls.plannedProductivityFactor = clamp(
    Math.round((Number(factor) || DEFAULT_PLANNED_PRODUCTIVITY_FACTOR) * 100) / 100,
    0.2,
    500
  );
  reapplyPlannedWindows(state);
  appendEvent(state, "control", `planned productivity factor set to ${state.controls.plannedProductivityFactor}`);
  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function setRunning(rawState, running) {
  const state = sanitizeState(rawState);
  state.running = Boolean(running);
  if (state.running && !state.startedAt) {
    state.startedAt = Date.now();
  }
  if (state.running && !state.lastAutoProgressAt) {
    state.lastAutoProgressAt = Date.now();
  }
  appendEvent(state, "control", state.running ? "Simulation started" : "Simulation paused");
  updateStatuses(state);
  appendHistory(state);
  return state;
}

function calculateWorkAmount(task, baseRatio, totalMultiplier, varianceMin, varianceMax) {
  const variabilityMultiplier = round(varianceMin + Math.random() * (varianceMax - varianceMin));
  const work = round(task.required * baseRatio * totalMultiplier * variabilityMultiplier);
  return { variabilityMultiplier, work: clamp(work, 0, task.required) };
}

function applyWorkToTask(state, teamNumber, source, baseRatio, options = {}) {
  const team = state.teams?.[teamNumber];
  const trade = getTradeByTeam(teamNumber);
  const candidate = getCandidateTask(state, teamNumber);

  if (!team || !trade || !candidate) {
    return false;
  }

  if (options.incrementTick !== false) {
    state.tick += 1;
  }

  const fatigueMultiplier = calculateFatigueMultiplier(team, state.controls);
  const learningMultiplier = calculateLearningMultiplier(team, state.controls, state.environment);
  const robotMultiplier = calculateRobotMultiplier(trade, state.environment);
  const phaseMultiplier = calculatePhaseMultiplier(state);
  const totalMultiplier = fatigueMultiplier * learningMultiplier * robotMultiplier * phaseMultiplier;
  let appliedMultiplier = totalMultiplier;
  let variabilityMultiplier;
  let work;

  if (source === "auto") {
    // Each task carries its own persistent actual-performance profile.
    variabilityMultiplier = candidate.autoProgressFactor || sampleAutoProgressFactor();
    work = round(getPlannedWorkPerTick(candidate) * AUTO_PROGRESS_RATIO * variabilityMultiplier);
  } else {
    // Manual taps should never feel worse than doing nothing, so clamp to a non-negative boost.
    appliedMultiplier = Math.max(1, robotMultiplier);
    const varianceRange = [1.05, 1.25];
    const calculated = calculateWorkAmount(
      candidate,
      baseRatio,
      appliedMultiplier,
      varianceRange[0],
      varianceRange[1]
    );
    variabilityMultiplier = calculated.variabilityMultiplier;
    work = calculated.work;
  }

  if (candidate.startTick === null) {
    candidate.startTick = state.tick;
  }

  team.lastTapTick = state.tick;
  team.variabilityMultiplier = variabilityMultiplier;
  team.fatigueMultiplier = round(fatigueMultiplier);
  team.learningMultiplier = round(learningMultiplier);
  team.robotMultiplier = round(robotMultiplier);
  team.productivityMultiplier = source === "auto"
    ? round(variabilityMultiplier)
    : round(appliedMultiplier * variabilityMultiplier);
  team.fatigueLevel = round((1 - fatigueMultiplier) * 100);

  candidate.done = clamp(round(candidate.done + work), 0, candidate.required);
  candidate.latestWork = work;
  team.effectiveWork = round(team.effectiveWork + work);

  if (candidate.done >= candidate.required) {
    candidate.finishTick = state.tick;
    appendEvent(state, "complete", `${trade.name} finished Floor ${candidate.floor}`, {
      team: teamNumber,
      taskId: candidate.id,
      source
    });
  } else {
    appendEvent(state, source, `${trade.name} worked on Floor ${candidate.floor}`, {
      team: teamNumber,
      taskId: candidate.id,
      work
    });
  }

  return true;
}

export function applyTap(rawState, teamNumber) {
  let state = sanitizeState(rawState);
  if (state.running && !isProjectComplete(state)) {
    state = applyAutoProgress(state, Date.now());
  }
  const team = state.teams?.[teamNumber];
  const trade = getTradeByTeam(teamNumber);

  if (!team || !trade) {
    appendEvent(state, "invalid", `Unknown team ${teamNumber}`);
    return state;
  }

  team.taps += 1;

  if (!state.running) {
    appendEvent(state, "ignored", `${trade.name} tapped while paused`);
    updateStatuses(state);
    appendHistory(state);
    return state;
  }

  const candidate = getCandidateTask(state, teamNumber);
  if (!candidate) {
    appendEvent(state, "blocked", `${trade.name} has no eligible activity`, { team: teamNumber });
    updateStatuses(state);
    appendHistory(state);
    return state;
  }

  team.validTaps += 1;
  applyWorkToTask(state, teamNumber, "tap", TAP_PROGRESS_RATIO, { incrementTick: false });

  if (isProjectComplete(state)) {
    state.running = false;
    appendEvent(state, "control", "Simulation completed");
  }

  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function applyAutoProgress(rawState, now = Date.now()) {
  const state = sanitizeState(rawState);
  if (!state.running || isProjectComplete(state)) {
    if (isProjectComplete(state) && state.running) {
      state.running = false;
      updateStatuses(state);
      appendHistory(state);
    }
    return state;
  }

  const lastAutoProgressAt = state.lastAutoProgressAt || now;
  const elapsed = now - lastAutoProgressAt;
  const steps = Math.floor(elapsed / AUTO_PROGRESS_INTERVAL_MS);
  if (steps <= 0) {
    return state;
  }

  for (let step = 0; step < steps; step += 1) {
    if (isProjectComplete(state)) {
      state.running = false;
      appendEvent(state, "control", "Simulation completed");
      break;
    }

    state.tick += 1;
    updateStatuses(state);
    TRADES.forEach((trade) => {
      const candidate = getCandidateTask(state, trade.team);
      if (!candidate || candidate.done >= candidate.required) {
        return;
      }

      applyWorkToTask(state, trade.team, "auto", AUTO_PROGRESS_RATIO, { incrementTick: false });
    });

    if (isProjectComplete(state)) {
      state.running = false;
      appendEvent(state, "control", "Simulation completed");
      break;
    }
  }

  state.lastAutoProgressAt = lastAutoProgressAt + steps * AUTO_PROGRESS_INTERVAL_MS;
  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function getTeamSnapshot(state, teamNumber) {
  const safeState = sanitizeState(state);
  const trade = getTradeByTeam(teamNumber);
  if (!trade) {
    return null;
  }
  const team = safeState.teams[teamNumber];
  const task = safeState.tasks[team.currentTaskId] || getFallbackTask(safeState, teamNumber);
  return {
    trade,
    team,
    task,
    activeFloor: getActiveFloor(safeState),
    overallProgressPct: Math.round(overallProgress(safeState) * 100)
  };
}

export function getDashboardMetrics(state) {
  const safeState = sanitizeState(state);
  const workingCrews = TRADES.filter((trade) => {
    const candidate = Object.values(safeState.tasks).find((task) =>
      task.team === trade.team && isEligible(safeState, task) && task.done > 0 && task.done < task.required
    );
    return Boolean(candidate) && safeState.running;
  }).length;

  const blockedCrews = TRADES.filter((trade) => {
    const remainingTasks = Object.values(safeState.tasks).filter((task) =>
      task.team === trade.team && task.done < task.required
    );
    if (!remainingTasks.length) {
      return false;
    }
    const eligibleTask = remainingTasks.find((task) => isEligible(safeState, task));
    return !eligibleTask;
  }).length;

  return {
    overallProgressPct: Math.round(overallProgress(safeState) * 100),
    tick: safeState.tick,
    workingCrews,
    blockedCrews,
    completedTasks: getCompletedTasksCount(safeState),
    activeFloor: getActiveFloor(safeState)
  };
}

export function getTaskNodeState(task) {
  if (!task) {
    return "blocked";
  }
  if (task.done >= task.required) {
    return "complete";
  }
  if (task.status === "active") {
    return "active";
  }
  if (task.status === "ready") {
    return "ready";
  }
  return "blocked";
}

export function getTradeColor(tradeId) {
  return getTradeById(tradeId)?.color || "#4b5563";
}
