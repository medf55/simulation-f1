/**
 * Simulation principale de course automobile - Grand Prix IA & Steering Behaviors Reynolds.
 * Combine algorithme génétique, réseaux de neurones, pilotage humain (PlayerCar extends Vehicle),
 * comportements de flocking (Séparation inter-voitures 7-Boids, Aspiration aérodynamique),
 * obstacles dynamiques (Hazard extends Vehicle), caméra poursuite dynamique, audio procédural
 * et chronométrage F1 avec persistance localStorage.
 */

const MODE_EVOLUTION = 'evolution';
const MODE_RACE = 'race';
const MODE_TIME_ATTACK = 'time_attack';

let currentMode = MODE_EVOLUTION;
let TOTAL = 50;
let MUTATION_RATE = 0.10;
let LIFESPAN = 45;
let SIGHT = 120;
let generationCount = 0;

let walls = [];
let checkpoints = [];
let inside = [];
let outside = [];
let start, end;

let population = [];
let savedVehicles = [];
let playerCar = null;
let ghostChampion = null;
let hazards = [];

let isPaused = false;
let isTurboMode = false;
let isDebugMode = false;
let showBrainHUD = true;
let isChaseCam = false;
let showHazards = false;
let hasSeparation = true;
let separationDist = 24;
let simSpeed = 1;

let camPos = { x: 0, y: 0 };
let camZoom = 1.25;

// Gestion du compte à rebours de course
let raceCountdown = 0;
let raceTimer = 0;
let raceMaxLaps = 3;
let raceWinner = null;
let lastCountdownStage = -1;

// Nouveaux états d'arcade & course
let trackBuffer = null;
let showRacingLine = false;
let confettiParticles = [];
let sectorBest = [Infinity, Infinity, Infinity];
let sectorCurrent = [0, 0, 0];

// Clavier joueur
const keysPressed = {
  up: false,
  down: false,
  left: false,
  right: false
};

let currentConfig = {
  numSensors: 5,
  fov: Math.PI * 0.6, // 108°
  sight: 120,
  maxspeed: 6,
  maxforce: 0.28,
  numHiddenLayers: 1,
  neuronsPerLayer: 10,
  hiddenLayers: [10],
  activation: 'tanh',
  includeSpeedSensor: false,
  populationSize: 50,
  mutationRate: 0.10,
  lifespan: 45,
  elitismCount: 2,
  pathWidth: 60
};

// Construction procédurale du circuit avec bruit de Perlin
function buildTrack(noiseMax = 3.5, pathWidth = null) {
  const pWidth = pathWidth || currentConfig.pathWidth || 60;
  checkpoints = [];
  inside = [];
  outside = [];

  const totalPoints = 65;
  const startX = random(1000);
  const startY = random(1000);

  for (let i = 0; i < totalPoints; i++) {
    const a = map(i, 0, totalPoints, 0, TWO_PI);
    const xoff = map(cos(a), -1, 1, 0, noiseMax) + startX;
    const yoff = map(sin(a), -1, 1, 0, noiseMax) + startY;
    const cW = (typeof width !== 'undefined' && width > 100) ? width : (windowWidth || 1200);
    const cH = (typeof height !== 'undefined' && height > 100) ? height : (windowHeight || 800);
    const xr = map(noise(xoff, yoff), 0, 1, 130, cW * 0.44);
    const yr = map(noise(xoff, yoff), 0, 1, 130, cH * 0.44);

    const x1 = cW / 2 + (xr - pWidth) * cos(a);
    const y1 = cH / 2 + (yr - pWidth) * sin(a);
    const x2 = cW / 2 + (xr + pWidth) * cos(a);
    const y2 = cH / 2 + (yr + pWidth) * sin(a);

    checkpoints.push(new Boundary(x1, y1, x2, y2));
    inside.push(createVector(x1, y1));
    outside.push(createVector(x2, y2));
  }

  walls = [];
  for (let i = 0; i < checkpoints.length; i++) {
    const a1 = inside[i];
    const b1 = inside[(i + 1) % checkpoints.length];
    walls.push(new Boundary(a1.x, a1.y, b1.x, b1.y));

    const a2 = outside[i];
    const b2 = outside[(i + 1) % checkpoints.length];
    walls.push(new Boundary(a2.x, a2.y, b2.x, b2.y));
  }

  start = checkpoints[0].midpoint();
  end = checkpoints[checkpoints.length - 1].midpoint();
  camPos = { x: start.x, y: start.y };

  renderTrackToBuffer();
  spawnHazards();
  spawnPlayerCar();
}

// Pré-rendu optimisé du circuit dans un buffer graphique (Offscreen Canvas 60 FPS)
function renderTrackToBuffer() {
  if (typeof createGraphics !== 'function') return;
  const cW = (typeof width !== 'undefined' && width > 100) ? width : (windowWidth || 1200);
  const cH = (typeof height !== 'undefined' && height > 100) ? height : (windowHeight || 800);
  if (!trackBuffer || trackBuffer.width !== cW || trackBuffer.height !== cH) {
    trackBuffer = createGraphics(cW, cH);
  }
  trackBuffer.clear();
  if (inside.length === 0 || outside.length === 0) return;

  // 1. Fond asphalte
  trackBuffer.noStroke();
  trackBuffer.fill(24, 32, 48);
  for (let i = 0; i < checkpoints.length; i++) {
    const a1 = inside[i];
    const b1 = inside[(i + 1) % checkpoints.length];
    const a2 = outside[i];
    const b2 = outside[(i + 1) % checkpoints.length];
    trackBuffer.quad(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y, a2.x, a2.y);
  }

  // 1b. Ligne médiane blanche en pointillés
  trackBuffer.stroke(255, 255, 255, 45);
  trackBuffer.strokeWeight(2);
  for (let i = 0; i < checkpoints.length; i += 2) {
    const m1 = checkpoints[i].midpoint();
    const m2 = checkpoints[(i + 1) % checkpoints.length].midpoint();
    trackBuffer.line(m1.x, m1.y, m2.x, m2.y);
  }

  // 2. Vibreurs bicolores blanc/rouge
  for (let i = 0; i < checkpoints.length; i++) {
    const a1 = inside[i];
    const b1 = inside[(i + 1) % checkpoints.length];
    const a2 = outside[i];
    const b2 = outside[(i + 1) % checkpoints.length];
    const isWhite = (i % 2 === 0);
    trackBuffer.stroke(isWhite ? 245 : 220, isWhite ? 245 : 38, isWhite ? 245 : 38);
    trackBuffer.strokeWeight(3.5);
    trackBuffer.line(a1.x, a1.y, b1.x, b1.y);
    trackBuffer.line(a2.x, a2.y, b2.x, b2.y);
  }

  // 3. Checkpoints subtils bleu néon
  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    trackBuffer.stroke(56, 189, 248, 35);
    trackBuffer.strokeWeight(1);
    trackBuffer.line(cp.a.x, cp.a.y, cp.b.x, cp.b.y);
  }

  // 4. Ligne de départ / arrivée dorée
  if (checkpoints[0]) {
    trackBuffer.stroke(245, 158, 11, 230);
    trackBuffer.strokeWeight(4.5);
    trackBuffer.line(checkpoints[0].a.x, checkpoints[0].a.y, checkpoints[0].b.x, checkpoints[0].b.y);
  }
}

// Dessin de la Trajectoire Idéale assistée (Racing Line F1)
function drawRacingLine() {
  if (checkpoints.length < 3) return;
  push();
  noFill();
  strokeWeight(2.5);

  for (let i = 0; i < checkpoints.length; i++) {
    const p1 = checkpoints[i].midpoint();
    const p2 = checkpoints[(i + 1) % checkpoints.length].midpoint();
    const p3 = checkpoints[(i + 2) % checkpoints.length].midpoint();

    const a1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const a2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
    let diff = Math.abs(a2 - a1);
    while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);

    if (diff < 0.12) {
      stroke(16, 185, 129, 200); // Vert en ligne droite
    } else if (diff < 0.28) {
      stroke(245, 158, 11, 220); // Jaune entrée de virage
    } else {
      stroke(239, 68, 68, 230); // Rouge gros freinage / apex
    }

    line(p1.x, p1.y, p2.x, p2.y);
  }
  pop();
}

// Génération des obstacles et flaques d'huile sur la trajectoire (6-ObstacleAvoidance)
function spawnHazards() {
  hazards = [];
  if (!showHazards || checkpoints.length < 20) return;

  const targetIndices = [14, 28, 42, 56];
  for (let idx of targetIndices) {
    if (checkpoints[idx]) {
      const mid = checkpoints[idx].midpoint();
      const type = (idx % 2 === 0) ? 'oil' : 'cone';
      const HazardClass = (typeof Hazard !== 'undefined') ? Hazard : globalThis.Hazard;
      if (HazardClass) {
        hazards.push(new HazardClass(mid.x + random(-12, 12), mid.y + random(-12, 12), type, type === 'oil' ? 20 : 14));
      }
    }
  }
}

// Initialisation de la voiture du joueur humain
function spawnPlayerCar() {
  if (!start) return;
  const PlayerClass = (typeof PlayerCar !== 'undefined') ? PlayerCar : globalThis.PlayerCar;
  if (!PlayerClass) return;

  playerCar = new PlayerClass(start.x, start.y, {
    maxspeed: 5.2,
    maxforce: 0.28,
    steerSensitivity: 0.068
  });

  // Calcul du cap initial aligné avec le premier tronçon
  if (checkpoints[1]) {
    const nextMid = checkpoints[1].midpoint();
    playerCar.headingAngle = atan2(nextMid.y - start.y, nextMid.x - start.x);
  }
}

// Initialisation P5
function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent(document.body);

  try {
    if (typeof tf !== 'undefined' && tf && typeof tf.setBackend === 'function') {
      tf.setBackend('cpu');
    }
  } catch (err) {
    console.warn("TensorFlow backend cpu non disponible, basculement en mode JS haute performance.");
  }

  buildTrack();
  resetPopulation();
  bindUIControls();
  bindKeyboardListeners();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildTrack();
}

// Réinitialisation de la population avec la configuration courante
function resetPopulation() {
  for (let v of population) {
    if (v && v.dispose) {
      try { v.dispose(); } catch (e) {}
    }
  }
  for (let v of savedVehicles) {
    if (v && v.dispose) {
      try { v.dispose(); } catch (e) {}
    }
  }

  population = [];
  savedVehicles = [];
  generationCount = 0;

  updateHiddenLayersArray();

  if (currentMode === MODE_TIME_ATTACK) {
    // Mode Contre-la-Montre : 100% solo contre le chrono
    population = [];
    savedVehicles = [];
    if (ghostChampion && ghostChampion.dispose) {
      try { ghostChampion.dispose(); } catch (e) {}
    }
    ghostChampion = null;
    if (start) {
      spawnPlayerCar();
    }
  } else if (currentMode === MODE_RACE && start && checkpoints.length > 1) {
    // Mode Course : Grille de départ étagée pour 7 concurrents IA de différents niveaux + Joueur
    const prevCp = checkpoints[checkpoints.length - 1].midpoint();
    const nextCp = checkpoints[1].midpoint();
    let trackDir;
    if (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.sub) {
      trackDir = p5.Vector.sub(nextCp, prevCp).normalize();
    } else {
      const dx = nextCp.x - prevCp.x;
      const dy = nextCp.y - prevCp.y;
      const m = Math.hypot(dx, dy) || 1;
      trackDir = { x: dx / m, y: dy / m };
    }
    const trackPerp = { x: -trackDir.y, y: trackDir.x };
    const trackAngle = Math.atan2(trackDir.y, trackDir.x);

    // Initialiser le Joueur en position 3 sur la grille (Ligne 2, côté intérieur)
    spawnPlayerCar();
    if (playerCar) {
      const pGx = start.x - trackDir.x * 64 + trackPerp.x * (-14);
      const pGy = start.y - trackDir.y * 64 + trackPerp.y * (-14);
      playerCar.pos.set(pGx, pGy);
      playerCar.headingAngle = trackAngle;
      playerCar.vel.set(0, 0);
      playerCar.acc.set(0, 0);
      playerCar.throttle = 0;
      playerCar.laps = 0;
      playerCar.index = 0;
      playerCar.fitness = 0;
      playerCar.crashed = false;
      playerCar.crashTimer = 0;
    }

    // Positions étagées sur la grille pour les 7 bolides IA (P1, P2, P4, P5, P6, P7, P8)
    const gridPositions = [
      { dist: 32, side: 1 },   // P1: Max (Légende)
      { dist: 32, side: -1 },  // P2: Lewis (Expert)
      { dist: 64, side: 1 },   // P4: Fernando (Pro)
      { dist: 96, side: -1 },  // P5: Charles (Moyen)
      { dist: 96, side: 1 },   // P6: Lando (Régulier)
      { dist: 128, side: -1 }, // P7: Pierre (Amateur)
      { dist: 128, side: 1 }   // P8: Rookie (Débutant)
    ];

    for (let i = 0; i < RACE_DRIVERS.length; i++) {
      const driver = RACE_DRIVERS[i];
      const slot = gridPositions[i];
      const ai = new CarVehicle(null, {
        ...currentConfig,
        driverProfile: driver,
        isRaceMode: true,
        maxspeed: driver.maxspeed,
        maxforce: driver.maxforce
      });

      const gx = start.x - trackDir.x * slot.dist + trackPerp.x * (slot.side * 14);
      const gy = start.y - trackDir.y * slot.dist + trackPerp.y * (slot.side * 14);
      ai.pos.set(gx, gy);
      if (ai.vel && typeof ai.vel.set === 'function') ai.vel.set(0, 0);
      ai.counter = 0;
      ai.index = 0;
      ai.laps = 0;
      ai.fitness = 0;
      population.push(ai);
    }
  } else {
    // Mode Évolution : Flotte génétique complète
    const count = currentConfig.populationSize || 50;
    for (let i = 0; i < count; i++) {
      population.push(new CarVehicle(null, currentConfig));
    }
    if (start) {
      spawnPlayerCar();
    }
  }
}

// 7 Pilotes IA aux personnalités et niveaux distincts (de Débutant à Légende)
const RACE_DRIVERS = [
  {
    name: "Max",
    title: "Légende",
    skill: 1.00,
    tier: "champion",
    maxspeed: 5.3,
    maxforce: 0.30,
    steerRate: 0.080,
    lookAhead: 2,
    wobble: 0.00,
    caution: 0.82,
    color: '#eab308',
    rgb: [234, 179, 8],
    number: 1
  },
  {
    name: "Lewis",
    title: "Expert",
    skill: 0.88,
    tier: "expert",
    maxspeed: 5.0,
    maxforce: 0.28,
    steerRate: 0.075,
    lookAhead: 2,
    wobble: 0.01,
    caution: 0.85,
    color: '#a855f7',
    rgb: [168, 85, 247],
    number: 44
  },
  {
    name: "Fernando",
    title: "Pro",
    skill: 0.78,
    tier: "pro",
    maxspeed: 4.7,
    maxforce: 0.26,
    steerRate: 0.072,
    lookAhead: 2,
    wobble: 0.02,
    caution: 0.88,
    color: '#10b981',
    rgb: [16, 185, 129],
    number: 14
  },
  {
    name: "Charles",
    title: "Moyen",
    skill: 0.68,
    tier: "intermediaire",
    maxspeed: 4.4,
    maxforce: 0.24,
    steerRate: 0.068,
    lookAhead: 1,
    wobble: 0.03,
    caution: 0.90,
    color: '#ef4444',
    rgb: [239, 68, 68],
    number: 16
  },
  {
    name: "Lando",
    title: "Régulier",
    skill: 0.58,
    tier: "regulier",
    maxspeed: 4.1,
    maxforce: 0.22,
    steerRate: 0.065,
    lookAhead: 1,
    wobble: 0.04,
    caution: 0.92,
    color: '#f97316',
    rgb: [249, 115, 22],
    number: 4
  },
  {
    name: "Pierre",
    title: "Amateur",
    skill: 0.46,
    tier: "amateur",
    maxspeed: 3.7,
    maxforce: 0.20,
    steerRate: 0.060,
    lookAhead: 1,
    wobble: 0.06,
    caution: 0.95,
    color: '#06b6d4',
    rgb: [6, 182, 212],
    number: 10
  },
  {
    name: "Rookie",
    title: "Débutant",
    skill: 0.32,
    tier: "rookie",
    maxspeed: 3.2,
    maxforce: 0.17,
    steerRate: 0.052,
    lookAhead: 0,
    wobble: 0.10,
    caution: 0.98,
    color: '#94a3b8',
    rgb: [148, 163, 184],
    number: 99
  }
];

function updateHiddenLayersArray() {
  currentConfig.hiddenLayers = [];
  for (let i = 0; i < currentConfig.numHiddenLayers; i++) {
    currentConfig.hiddenLayers.push(currentConfig.neuronsPerLayer);
  }
}

// Changement interactif de mode de jeu
function setGameMode(mode) {
  currentMode = mode;

  // Mise à jour visuelle des onglets
  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
  });

  const modeBadge = document.getElementById('lbl-active-mode');
  const modeDesc = document.getElementById('lbl-mode-desc');
  const cardGen = document.getElementById('card-gen');
  const cardAlive = document.getElementById('card-alive');

  if (mode === MODE_EVOLUTION) {
    if (modeBadge) modeBadge.textContent = "Laboratoire IA";
    if (modeDesc) modeDesc.textContent = "Entraînement de la flotte avec algorithme génétique et réseaux de neurones.";
    if (cardGen) cardGen.style.display = 'flex';
    if (cardAlive) cardAlive.style.display = 'flex';
    isChaseCam = false;
    raceCountdown = 0;
    resetPopulation();
    showToast("🧬 Mode Laboratoire IA actif");
  } else if (mode === MODE_RACE) {
    if (modeBadge) modeBadge.textContent = "Course Joueur vs Flotte IA";
    if (modeDesc) modeDesc.textContent = "Affrontez 7 concurrents IA de différents niveaux sur 3 tours !";
    if (cardGen) cardGen.style.display = 'none';
    if (cardAlive) cardAlive.style.display = 'flex';
    isChaseCam = false;
    if (ghostChampion && ghostChampion.dispose) {
      try { ghostChampion.dispose(); } catch (e) {}
    }
    ghostChampion = null;
    startRaceCountdown();
    if (playerCar) {
      camPos.x = playerCar.pos.x;
      camPos.y = playerCar.pos.y;
    }
    showToast("🏎️ Mode Course lancé : 7 concurrents IA sur la grille !");
  } else if (mode === MODE_TIME_ATTACK) {
    if (modeBadge) modeBadge.textContent = "Contre-la-Montre Solo";
    if (modeDesc) modeDesc.textContent = "Battez le record du tour en solo absolu ! Pilotez avec ZQSD ou les Flèches.";
    if (cardGen) cardGen.style.display = 'none';
    if (cardAlive) cardAlive.style.display = 'none';
    isChaseCam = false;
    population = [];
    savedVehicles = [];
    if (ghostChampion && ghostChampion.dispose) {
      try { ghostChampion.dispose(); } catch (e) {}
    }
    ghostChampion = null;
    raceCountdown = 0;
    raceWinner = null;
    spawnPlayerCar();
    if (playerCar && start) {
      playerCar.pos.set(start.x, start.y);
      playerCar.vel.set(0, 0);
      playerCar.acc.set(0, 0);
      playerCar.throttle = 0;
      playerCar.laps = 0;
      camPos.x = playerCar.pos.x;
      camPos.y = playerCar.pos.y;
    }
    showToast("⏱️ Contre-la-Montre Solo actif : Chassez le meilleur chrono !");
  }

  // Masquer le panneau de configuration pour libérer la vue et le HUD de course
  const panel = document.getElementById('control-panel');
  if (panel && (mode === MODE_RACE || mode === MODE_TIME_ATTACK)) {
    panel.classList.add('hidden');
  }

  // Retirer le focus d'éventuels champs input pour que le clavier réponde immédiatement
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  updateQuickButtons();
}
window.setGameMode = setGameMode;

function startRaceCountdown() {
  raceCountdown = 150; // 2.5 secondes avec 5 feux rouges LED progressifs
  lastCountdownStage = 0;
  raceWinner = null;
  confettiParticles = [];
  const panel = document.getElementById('control-panel');
  if (panel) panel.classList.add('hidden');
  resetPopulation();
  if (playerCar) {
    camPos.x = playerCar.pos.x;
    camPos.y = playerCar.pos.y;
  }
}

// Boucle principale de rendu et physique
function draw() {
  background(11, 15, 25);

  if (!isPaused) {
    const cycles = (isTurboMode && currentMode === MODE_EVOLUTION) ? 25 : simSpeed;
    for (let n = 0; n < cycles; n++) {
      try {
        stepSimulation();
      } catch (err) {
        console.error("Erreur durant stepSimulation:", err);
        break;
      }
    }
  }

  // Cible de la caméra (joueur ou leader IA)
  let bestCar = population[0];
  for (let vehicle of population) {
    if (vehicle.fitness > (bestCar ? bestCar.fitness : -1)) {
      bestCar = vehicle;
    }
  }

  const cameraTarget = (currentMode !== MODE_EVOLUTION && playerCar)
    ? playerCar
    : (bestCar || playerCar);

  // Mise à jour fluide de la position caméra
  if (cameraTarget && cameraTarget.pos) {
    camPos.x += (cameraTarget.pos.x - camPos.x) * 0.14;
    camPos.y += (cameraTarget.pos.y - camPos.y) * 0.14;
  }

  // RENDU MONDE (avec ou sans caméra dynamique)
  if (isChaseCam) {
    push();
    translate(width / 2, height / 2);
    scale(camZoom);
    translate(-camPos.x, -camPos.y);
  }

  // 1. Environnement du circuit (asphalte, vibreurs, checkpoints)
  drawTrackEnvironment();

  // 2. Obstacles et flaques d'huile
  if (showHazards) {
    for (let hazard of hazards) {
      hazard.show();
    }
  }

  // 3. Voiture Ghost IA (si chargée et HORS mode Time Attack solo)
  if (ghostChampion && !ghostChampion.dead && currentMode !== MODE_TIME_ATTACK) {
    push();
    drawingContext.globalAlpha = 0.55;
    ghostChampion.show(true, false);
    drawingContext.globalAlpha = 1.0;
    pop();
  }

  // 4. Voitures IA de la population (HORS mode Time Attack solo)
  if (currentMode !== MODE_TIME_ATTACK) {
    for (let vehicle of population) {
      if (vehicle !== bestCar) {
        vehicle.show(false, isDebugMode);
      }
    }

    // Leader IA en surbrillance (uniquement en mode Évolution)
    if (bestCar && !bestCar.dead) {
      if (currentMode === MODE_EVOLUTION) {
        bestCar.highlight(isDebugMode);
      } else {
        bestCar.show(false, isDebugMode);
      }
    }
  }

  // 5. Voiture du joueur
  if (playerCar && (currentMode !== MODE_EVOLUTION || isDebugMode)) {
    playerCar.show();
  }

  if (isChaseCam) {
    pop();
  }

  // INTERFACE HUD ÉCRAN (Fixe au-dessus du monde)
  drawScreenHUD(bestCar);

  // Visualiseur du cerveau HUD (en mode évolution)
  if (showBrainHUD && currentMode === MODE_EVOLUTION && bestCar && !bestCar.dead) {
    drawBrainHUD(bestCar);
  }

  // Mise à jour de la télémétrie DOM
  updateTelemetryDOM(bestCar);
}

// Avancement physique de la simulation
function stepSimulation() {
  // Gestion du portique de départ et de la grille en mode course
  if (currentMode === MODE_RACE) {
    if (raceCountdown > 0) {
      let currentStage = 0;
      if (raceCountdown <= 25) currentStage = 5;
      else if (raceCountdown <= 55) currentStage = 4;
      else if (raceCountdown <= 85) currentStage = 3;
      else if (raceCountdown <= 115) currentStage = 2;
      else if (raceCountdown <= 145) currentStage = 1;

      if (currentStage > lastCountdownStage && currentStage > 0) {
        lastCountdownStage = currentStage;
        if (sounds) sounds.playF1Beep(false); // Bip LED rouge grave
      }

      raceCountdown--;

      if (raceCountdown === 0) {
        if (sounds) sounds.playF1Beep(true); // Bip aigu "LIGHTS OUT"
        lastCountdownStage = -1;
      }
      return;
    } else if (raceCountdown > -40) {
      raceCountdown--;
    }
  }

  // En mode Contre-la-Montre solo : uniquement le joueur sur le circuit
  if (currentMode === MODE_TIME_ATTACK) {
    if (playerCar) {
      playerCar.handleInput(keysPressed);
      const prevLaps = playerCar.laps;
      const prevFit = playerCar.fitness;

      playerCar.check(checkpoints);
      playerCar.checkWalls(walls);
      playerCar.update();

      if (sounds) {
        if (playerCar.fitness > prevFit) sounds.playCheckpointDing();
        if (playerCar.laps > prevLaps) {
          sounds.playLapFanfare();
          sectorCurrent = [0, 0, 0];
        }
        const curSpd = playerCar.vel && typeof playerCar.vel.mag === 'function' ? playerCar.vel.mag() : 0;
        sounds.updateEngine(curSpd / (playerCar.maxspeed || 1));
      }

      updateTimeAttackSectors();

      if (showHazards) {
        for (let h of hazards) {
          if (h.checkCollision(playerCar) && sounds) {
            sounds.playTireScreech();
          }
        }
      }
    }
    return;
  }

  const otherVehiclesList = [...population];
  if (playerCar && currentMode !== MODE_EVOLUTION) {
    otherVehiclesList.push(playerCar);
  }

  // 1. Mise à jour du joueur humain
  if (playerCar && currentMode !== MODE_EVOLUTION) {
    playerCar.handleInput(keysPressed);
    if (hasSeparation && population.length > 0) playerCar.separate(population, separationDist);
    if (population.length > 0) playerCar.checkDrafting(population);
    const prevLaps = playerCar.laps;
    const prevFit = playerCar.fitness;

    playerCar.check(checkpoints);
    playerCar.checkWalls(walls);
    playerCar.update();

    // Sons d'action joueur
    if (sounds) {
      if (playerCar.fitness > prevFit) sounds.playCheckpointDing();
      if (playerCar.laps > prevLaps) sounds.playLapFanfare();
      const curSpd = playerCar.vel && typeof playerCar.vel.mag === 'function' ? playerCar.vel.mag() : 0;
      sounds.updateEngine(curSpd / (playerCar.maxspeed || 1));
    }

    // Collisions avec obstacles/flaques
    if (showHazards) {
      for (let h of hazards) {
        if (h.checkCollision(playerCar) && sounds) {
          sounds.playTireScreech();
        }
      }
    }

    // Condition de victoire en mode course
    if (currentMode === MODE_RACE && playerCar.laps >= raceMaxLaps && !raceWinner) {
      triggerRaceVictory("🏆 JOUEUR 1 A GAGNÉ LE GRAND PRIX !");
    }
  }

  // 2. Mise à jour du Ghost Champion (si hors time attack)
  if (ghostChampion && !ghostChampion.dead && currentMode !== MODE_TIME_ATTACK) {
    ghostChampion.applyBehaviors(walls, otherVehiclesList);
    ghostChampion.check(checkpoints);
    ghostChampion.update();
  }

  // 3. Mise à jour de la flotte IA
  let bestP = population[0];
  for (let vehicle of population) {
    const listForVehicle = hasSeparation ? otherVehiclesList : null;
    vehicle.applyBehaviors(walls, listForVehicle);
    vehicle.check(checkpoints);
    vehicle.update();

    if (showHazards) {
      for (let h of hazards) {
        h.checkCollision(vehicle);
      }
    }

    if (vehicle.fitness > (bestP ? bestP.fitness : -1)) {
      bestP = vehicle;
    }

    if (currentMode === MODE_RACE && vehicle.laps >= raceMaxLaps && !raceWinner) {
      const winnerName = vehicle.driverProfile ? vehicle.driverProfile.name : "L'IA";
      const winnerTitle = vehicle.driverProfile ? vehicle.driverProfile.title : "Championne";
      triggerRaceVictory(`🤖 ${winnerName} (${winnerTitle}) REMPORTE LE GRAND PRIX !`);
    }
  }

  // Archivage et reproduction génétique (seulement en mode Évolution ou Course)
  if (currentMode === MODE_EVOLUTION) {
    for (let i = population.length - 1; i >= 0; i--) {
      const v = population[i];
      if (v.dead || v.finished) {
        savedVehicles.push(population.splice(i, 1)[0]);
      }
    }

    if (population.length === 0) {
      nextGeneration(currentConfig);
    }
  }
}

// Rendu moderne optimisé du circuit (Buffer graphique 60 FPS, vibreurs, racing line)
function drawTrackEnvironment() {
  if (inside.length === 0 || outside.length === 0) return;

  if (!trackBuffer) {
    renderTrackToBuffer();
  }
  if (trackBuffer) {
    image(trackBuffer, 0, 0);
  }

  // Trajectoire idéale assistée dynamique (Touche L)
  if (showRacingLine && checkpoints.length > 2) {
    drawRacingLine();
  }

  // Overlay des numéros de checkpoints uniquement en mode Debug
  if (isDebugMode) {
    push();
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      stroke(0, 210, 255, 120);
      strokeWeight(1.5);
      line(cp.a.x, cp.a.y, cp.b.x, cp.b.y);

      const mid = cp.midpoint();
      fill(0, 210, 255);
      noStroke();
      textSize(8);
      textAlign(CENTER, CENTER);
      text(i, mid.x, mid.y);
    }
    pop();
  }
}

// Rendu des instruments de course à l'écran (Portique F1, Speedometer, Chrono, Mini-map, Podium)
function drawScreenHUD(bestCar) {
  push();

  // 1. PORTIQUE DE DÉPART OFFICIEL F1 (5 feux rouges)
  if (currentMode === MODE_RACE && raceCountdown > -40) {
    drawF1StartingGantry();
  }

  // 2. ÉCRAN DE PODIUM & CÉLÉBRATION DE FIN DE COURSE
  if (raceWinner && currentMode === MODE_RACE) {
    drawGrandPrixPodium();
  }

  // 3. TACHYMÈTRE / SPEEDOMETER (en mode Joueur ou Poursuite)
  if (playerCar && currentMode !== MODE_EVOLUTION) {
    let speed = 0;
    if (playerCar.vel && typeof playerCar.vel.mag === 'function') {
      speed = playerCar.vel.mag();
    } else if (playerCar.vel) {
      speed = Math.hypot(playerCar.vel.x || 0, playerCar.vel.y || 0);
    }
    const kmh = (Number.isFinite(speed) && !isNaN(speed)) ? Math.round(speed * 28) : 0;
    const hudX = 24;
    const hudY = height - 110;

    // Cadre tachy
    fill(13, 20, 36, 210);
    stroke(56, 189, 248, 80);
    strokeWeight(1.5);
    rect(hudX, hudY, 180, 85, 12);

    // Titre
    noStroke();
    fill(148, 163, 184);
    textSize(10);
    textStyle(BOLD);
    textAlign(LEFT, TOP);
    text("TACHYMÈTRE", hudX + 14, hudY + 12);

    // Vitesse numérique
    fill(playerCar.isDrafting ? '#00d2ff' : '#ffffff');
    textSize(32);
    textAlign(LEFT, TOP);
    text(`${kmh}`, hudX + 14, hudY + 28);

    fill(0, 210, 255);
    textSize(12);
    text("KM/H", hudX + 75, hudY + 44);

    if (playerCar.isDrafting) {
      fill(56, 189, 248);
      textSize(10);
      text("⚡ ASPIRATION ACTIVE (+20%)", hudX + 14, hudY + 68);
    }

    // 4. CHRONO F1 (Tours et temps)
    const f1X = 220;
    fill(13, 20, 36, 210);
    stroke(56, 189, 248, 80);
    strokeWeight(1.5);
    rect(f1X, hudY, 210, 85, 12);

    noStroke();
    fill(148, 163, 184);
    textSize(10);
    textStyle(BOLD);
    textAlign(LEFT, TOP);
    text("CHRONOMÈTRE F1", f1X + 14, hudY + 12);

    // Temps en cours
    fill(255, 255, 255);
    textSize(15);
    textStyle(NORMAL);
    const curTime = playerCar.currentLapTime.toFixed(2);
    text(`Tour : ${playerCar.laps + 1} / ${currentMode === MODE_RACE ? raceMaxLaps : '∞'}`, f1X + 14, hudY + 30);

    text(`Temps : ${curTime}s`, f1X + 14, hudY + 48);

    if (playerCar.bestLapTime !== Infinity) {
      fill(16, 185, 129);
      text(`Record : ${playerCar.bestLapTime.toFixed(2)}s`, f1X + 14, hudY + 66);
    }

    // 4b. SECTEURS F1 (en mode Contre-la-Montre solo)
    if (currentMode === MODE_TIME_ATTACK) {
      const sBaseX = f1X + 225;
      for (let s = 0; s < 3; s++) {
        const sx = sBaseX + s * 64;
        fill(13, 20, 36, 210);
        stroke(56, 189, 248, 80);
        strokeWeight(1.2);
        rect(sx, hudY, 58, 85, 10);

        noStroke();
        fill(148, 163, 184);
        textSize(9.5);
        textStyle(BOLD);
        textAlign(CENTER, TOP);
        text(`S${s + 1}`, sx + 29, hudY + 12);

        const timeVal = sectorCurrent[s];
        let col = '#94a3b8';
        if (timeVal > 0) {
          if (timeVal <= sectorBest[s]) col = '#c084fc'; // Violet = Meilleur absolu
          else col = '#34d399'; // Vert = Amélioration
        }

        fill(col);
        textSize(12);
        textAlign(CENTER, CENTER);
        text(timeVal > 0 ? `${timeVal.toFixed(1)}s` : '--.-', sx + 29, hudY + 48);
      }
    }
  }

  // 5. MINI-MAP DU CIRCUIT (En haut à droite)
  drawCircuitMiniMap(bestCar);

  // 6. CLASSEMENT DE LA COURSE EN DIRECT (Mode 2)
  if (currentMode === MODE_RACE) {
    drawRaceLeaderboard();
  }

  pop();
}

// Mini-carte globale du circuit affichant les véhicules et obstacles en temps réel
function drawCircuitMiniMap(bestCar) {
  if (checkpoints.length === 0) return;

  const mapW = 160;
  const mapH = 110;
  const mapX = width - mapW - 18;
  const mapY = 70;

  push();
  fill(13, 20, 36, 210);
  stroke(56, 189, 248, 80);
  strokeWeight(1.2);
  rect(mapX, mapY, mapW, mapH, 10);

  // Échelle de conversion vers la mini-carte
  const scaleX = (mapW - 20) / width;
  const scaleY = (mapH - 20) / height;

  // Ligne de circuit sur la mini-map
  noFill();
  stroke(255, 255, 255, 60);
  strokeWeight(1.2);
  beginShape();
  for (let cp of checkpoints) {
    const mid = cp.midpoint();
    vertex(mapX + 10 + mid.x * scaleX, mapY + 10 + mid.y * scaleY);
  }
  endShape(CLOSE);

  // Point de départ doré
  if (start) {
    fill(245, 158, 11);
    noStroke();
    circle(mapX + 10 + start.x * scaleX, mapY + 10 + start.y * scaleY, 4.5);
  }

  // Points des voitures IA (couleur personnalisée selon le pilote)
  noStroke();
  for (let v of population) {
    if (!v.dead) {
      if (v.driverProfile && v.driverProfile.color) {
        fill(v.driverProfile.color);
        circle(mapX + 10 + v.pos.x * scaleX, mapY + 10 + v.pos.y * scaleY, 3.5);
      } else {
        fill(56, 189, 248, 140);
        circle(mapX + 10 + v.pos.x * scaleX, mapY + 10 + v.pos.y * scaleY, 2.5);
      }
    }
  }

  // Leader IA (Doré en mode évolution)
  if (bestCar && !bestCar.dead && currentMode === MODE_EVOLUTION) {
    fill(255, 215, 0);
    circle(mapX + 10 + bestCar.pos.x * scaleX, mapY + 10 + bestCar.pos.y * scaleY, 4.5);
  }

  // Joueur (Cyan néon vif avec pulsation)
  if (playerCar && (currentMode !== MODE_EVOLUTION || isDebugMode)) {
    fill(14, 165, 233);
    stroke(255, 255, 255);
    strokeWeight(1);
    circle(mapX + 10 + playerCar.pos.x * scaleX, mapY + 10 + playerCar.pos.y * scaleY, 5);
  }

  pop();
}

// Tableau de classement en direct de la course avec calcul d'écarts (+/- secondes)
function drawRaceLeaderboard() {
  if (currentMode !== MODE_RACE) return;

  const boardW = 220;
  const boardX = width - boardW - 18;
  const boardY = 192;

  const racers = [];
  if (playerCar) {
    let progress = 0;
    if (checkpoints.length > 0 && playerCar.pos) {
      const nextCp = checkpoints[playerCar.index];
      if (nextCp && nextCp.midpoint) {
        const mid = nextCp.midpoint();
        const d = Math.hypot(playerCar.pos.x - mid.x, playerCar.pos.y - mid.y);
        progress = Math.max(0, Math.min(0.99, 1 - d / 200));
      }
    }
    racers.push({
      name: "VOUS (Joueur 1)",
      isPlayer: true,
      color: '#00d2ff',
      laps: playerCar.laps || 0,
      score: (playerCar.laps || 0) * 1000 + (playerCar.index || 0) + progress
    });
  }

  for (let car of population) {
    const dName = car.driverProfile ? car.driverProfile.name : "IA";
    const dTitle = car.driverProfile ? car.driverProfile.title : "";
    const dColor = car.driverProfile ? car.driverProfile.color : "#f59e0b";
    let progress = 0;
    if (checkpoints.length > 0 && car.pos) {
      const nextCp = checkpoints[car.index];
      if (nextCp && nextCp.midpoint) {
        const mid = nextCp.midpoint();
        const d = Math.hypot(car.pos.x - mid.x, car.pos.y - mid.y);
        progress = Math.max(0, Math.min(0.99, 1 - d / 200));
      }
    }
    racers.push({
      name: `${dName} (${dTitle})`,
      isPlayer: false,
      color: dColor,
      laps: car.laps || 0,
      score: (car.laps || 0) * 1000 + (car.index || 0) + progress
    });
  }

  racers.sort((a, b) => b.score - a.score);

  push();
  fill(13, 20, 36, 215);
  stroke(245, 158, 11, 100);
  strokeWeight(1.2);
  const totalH = 30 + racers.length * 19;
  rect(boardX, boardY, boardW, totalH, 10);

  noStroke();
  fill(255, 215, 0);
  textSize(10);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text("🏁 CLASSEMENT COURSE (3 TOURS)", boardX + 10, boardY + 8);

  const playerEntry = racers.find(r => r.isPlayer);
  const playerScore = playerEntry ? playerEntry.score : 0;

  for (let i = 0; i < racers.length; i++) {
    const r = racers[i];
    const rowY = boardY + 26 + i * 19;

    if (r.isPlayer) {
      fill(0, 210, 255, 45);
      rect(boardX + 5, rowY - 1, boardW - 10, 17, 3);
      fill(0, 210, 255);
      textStyle(BOLD);
    } else {
      fill(r.color);
      textStyle(NORMAL);
    }

    textSize(9.5);
    textAlign(LEFT, CENTER);
    text(`P${i + 1}`, boardX + 10, rowY + 7);
    text(r.name, boardX + 30, rowY + 7);

    // Écart de temps relatif (+/- secondes)
    textAlign(RIGHT, CENTER);
    if (r.isPlayer) {
      text(`VOUS`, boardX + boardW - 10, rowY + 7);
    } else {
      const diffScore = r.score - playerScore;
      const gapSec = Math.abs(diffScore * 0.45).toFixed(1);
      const gapText = diffScore > 0 ? `+${gapSec}s` : `-${gapSec}s`;
      text(gapText, boardX + boardW - 10, rowY + 7);
    }
  }
  pop();
}

// Découpage et calcul des secteurs F1 en mode Contre-la-Montre solo
function updateTimeAttackSectors() {
  if (currentMode !== MODE_TIME_ATTACK || !playerCar || checkpoints.length < 3) return;
  const total = checkpoints.length;
  const s1End = Math.floor(total / 3);
  const s2End = Math.floor(2 * total / 3);

  const curIdx = playerCar.index;
  const curTime = playerCar.currentLapTime;

  if (curIdx >= s1End && curIdx < s2End && sectorCurrent[0] === 0 && curTime > 0.5) {
    sectorCurrent[0] = curTime;
    if (sectorCurrent[0] < sectorBest[0]) sectorBest[0] = sectorCurrent[0];
  } else if (curIdx >= s2End && sectorCurrent[1] === 0 && sectorCurrent[0] > 0) {
    sectorCurrent[1] = Math.max(0.1, curTime - sectorCurrent[0]);
    if (sectorCurrent[1] < sectorBest[1]) sectorBest[1] = sectorCurrent[1];
  } else if (curIdx === 0 && sectorCurrent[1] > 0 && sectorCurrent[2] === 0) {
    sectorCurrent[2] = Math.max(0.1, curTime - (sectorCurrent[0] + sectorCurrent[1]));
    if (sectorCurrent[2] < sectorBest[2]) sectorBest[2] = sectorCurrent[2];
  }
}

// Portique F1 officiel avec 5 feux rouges
function drawF1StartingGantry() {
  const gantryW = 320;
  const gantryH = 88;
  const gx = width / 2 - gantryW / 2;
  const gy = height / 2 - 110;

  push();
  fill(13, 20, 36, 235);
  stroke(30, 41, 59);
  strokeWeight(2.5);
  rect(gx, gy, gantryW, gantryH, 14);

  // 5 feux rouges LED F1
  let activeLights = 0;
  if (raceCountdown > 0) {
    if (raceCountdown <= 25) activeLights = 5;
    else if (raceCountdown <= 55) activeLights = 4;
    else if (raceCountdown <= 85) activeLights = 3;
    else if (raceCountdown <= 115) activeLights = 2;
    else if (raceCountdown <= 145) activeLights = 1;
  }

  for (let i = 0; i < 5; i++) {
    const lx = gx + 36 + i * 62;
    const ly = gy + 34;

    fill(15, 23, 42);
    stroke(51, 65, 85);
    strokeWeight(2);
    circle(lx, ly, 38);

    if (activeLights > i) {
      fill(239, 68, 68);
      noStroke();
      circle(lx, ly, 28);
      fill(255, 255, 255, 140);
      circle(lx - 4, ly - 4, 10);
    } else {
      fill(40, 20, 24);
      noStroke();
      circle(lx, ly, 28);
    }
  }

  noStroke();
  textAlign(CENTER, CENTER);
  if (raceCountdown <= 0) {
    fill(16, 185, 129);
    textSize(22);
    textStyle(BOLD);
    text("🟢 PARTEZ ! (LIGHTS OUT)", width / 2, gy + 68);
  } else {
    fill(245, 158, 11);
    textSize(13);
    textStyle(BOLD);
    text("DÉPART IMMINENT... MAINTENEZ L'ACCÉLÉRATEUR !", width / 2, gy + 68);
  }
  pop();
}

// Célébration et déclenchement de victoire
function triggerRaceVictory(winnerName) {
  raceWinner = winnerName;
  showToast(raceWinner);
  if (sounds) sounds.playLapFanfare();

  confettiParticles = [];
  for (let i = 0; i < 80; i++) {
    confettiParticles.push({
      x: width / 2 + (Math.random() - 0.5) * 360,
      y: (typeof height !== 'undefined' ? height * 0.25 : 200) + (Math.random() - 0.5) * 100,
      vx: (Math.random() - 0.5) * 6,
      vy: -Math.random() * 5 - 2,
      gravity: 0.12,
      size: 6 + Math.random() * 5,
      color: ['#f59e0b', '#10b981', '#00d2ff', '#ef4444', '#a855f7', '#ffffff'][Math.floor(Math.random() * 6)],
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.2,
      life: 1.0
    });
  }
}

// Écran de podium officiel Formule 1
function drawGrandPrixPodium() {
  if (!raceWinner || currentMode !== MODE_RACE) return;

  // Animation des confettis
  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    const c = confettiParticles[i];
    c.x += c.vx;
    c.y += c.vy;
    c.vy += c.gravity;
    c.rotation += c.vRot;
    c.life -= 0.006;

    push();
    translate(c.x, c.y);
    rotate(c.rotation);
    noStroke();
    fill(c.color);
    rect(0, 0, c.size, c.size * 0.6);
    pop();

    if (c.y > height || c.life <= 0) {
      confettiParticles.splice(i, 1);
    }
  }

  // Carte Podium
  const podW = 440;
  const podH = 200;
  const px = width / 2 - podW / 2;
  const py = 75;

  push();
  fill(13, 20, 36, 235);
  stroke(245, 158, 11);
  strokeWeight(2.5);
  rect(px, py, podW, podH, 16);

  noStroke();
  fill(255, 215, 0);
  textSize(17);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text("🏆 ARRIVÉE DU GRAND PRIX (3 TOURS)", width / 2, py + 14);

  fill(255, 255, 255);
  textSize(14);
  text(raceWinner, width / 2, py + 42);

  // Top 3
  const top3 = getTopRacers(3);
  const pColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
  const labels = ['🥇 1er', '🥈 2e', '🥉 3e'];

  for (let i = 0; i < top3.length; i++) {
    const r = top3[i];
    const colX = px + 28 + i * 130;
    const colY = py + 72;

    fill(15, 23, 42);
    stroke(pColors[i]);
    strokeWeight(1.5);
    rect(colX, colY, 118, 62, 8);

    noStroke();
    fill(pColors[i]);
    textSize(11);
    textStyle(BOLD);
    textAlign(CENTER, TOP);
    text(labels[i], colX + 59, colY + 8);

    fill(r.isPlayer ? '#00d2ff' : '#ffffff');
    textSize(11);
    text(r.name.split(' (')[0], colX + 59, colY + 26);

    fill(148, 163, 184);
    textSize(10);
    textStyle(NORMAL);
    text(`Tour ${r.laps}/3`, colX + 59, colY + 44);
  }

  // Bouton Revanche
  fill(245, 158, 11, 230);
  rect(width / 2 - 90, py + 150, 180, 34, 8);
  fill(15, 23, 42);
  textSize(12);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text("🔄 REVANCHE (Touche R)", width / 2, py + 167);
  pop();
}

function getTopRacers(count = 3) {
  const racers = [];
  if (playerCar) {
    let progress = 0;
    if (checkpoints.length > 0 && playerCar.pos) {
      const nextCp = checkpoints[playerCar.index];
      if (nextCp && nextCp.midpoint) {
        const mid = nextCp.midpoint();
        const d = Math.hypot(playerCar.pos.x - mid.x, playerCar.pos.y - mid.y);
        progress = Math.max(0, Math.min(0.99, 1 - d / 200));
      }
    }
    racers.push({
      name: "VOUS (Joueur 1)",
      isPlayer: true,
      color: '#00d2ff',
      laps: playerCar.laps || 0,
      score: (playerCar.laps || 0) * 1000 + (playerCar.index || 0) + progress
    });
  }

  for (let car of population) {
    const dName = car.driverProfile ? car.driverProfile.name : "IA";
    const dTitle = car.driverProfile ? car.driverProfile.title : "";
    const dColor = car.driverProfile ? car.driverProfile.color : "#f59e0b";
    let progress = 0;
    if (checkpoints.length > 0 && car.pos) {
      const nextCp = checkpoints[car.index];
      if (nextCp && nextCp.midpoint) {
        const mid = nextCp.midpoint();
        const d = Math.hypot(car.pos.x - mid.x, car.pos.y - mid.y);
        progress = Math.max(0, Math.min(0.99, 1 - d / 200));
      }
    }
    racers.push({
      name: `${dName} (${dTitle})`,
      isPlayer: false,
      color: dColor,
      laps: car.laps || 0,
      score: (car.laps || 0) * 1000 + (car.index || 0) + progress
    });
  }

  racers.sort((a, b) => b.score - a.score);
  return racers.slice(0, count);
}

// Dessin temps réel du Cerveau de la meilleure voiture (HUD)
function drawBrainHUD(car) {
  if (!car || !car.brain) return;

  const topology = car.brain.getTopology ? car.brain.getTopology() : {
    inputNodes: car.rays.length,
    hiddenLayers: currentConfig.hiddenLayers,
    outputNodes: 2
  };

  const hudW = 280;
  const hudH = 175;
  const hudX = width - hudW - 20;
  const hudY = height - hudH - 20;

  push();
  fill(13, 20, 36, 215);
  stroke(56, 189, 248, 80);
  strokeWeight(1.5);
  rect(hudX, hudY, hudW, hudH, 12);

  noStroke();
  fill(0, 210, 255);
  textSize(11);
  textStyle(BOLD);
  textAlign(LEFT, BASELINE);
  text("🧠 CERVEAU IA (LEADER)", hudX + 14, hudY + 22);

  textStyle(NORMAL);
  fill(148, 163, 184);
  textSize(9);
  text(`${topology.inputNodes} In → [${topology.hiddenLayers.join(',')}] → ${topology.outputNodes} Out`, hudX + 150, hudY + 22);

  const layers = [
    { count: topology.inputNodes, label: 'Vision', color: '#10b981' },
    ...topology.hiddenLayers.map((cnt, idx) => ({ count: cnt, label: `H${idx + 1}`, color: '#38bdf8' })),
    { count: topology.outputNodes, label: 'Actions', color: '#f59e0b' }
  ];

  const colSpacing = (hudW - 40) / (layers.length - 1);
  const layerPositions = [];

  for (let l = 0; l < layers.length; l++) {
    const lx = hudX + 22 + l * colSpacing;
    const count = layers[l].count;
    const maxDisplayed = Math.min(count, 8);
    const nodeSpacing = (hudH - 65) / Math.max(1, maxDisplayed - 1);
    const nodes = [];

    for (let n = 0; n < maxDisplayed; n++) {
      const ny = hudY + 45 + n * nodeSpacing;
      nodes.push({ x: lx, y: ny });
    }
    layerPositions.push(nodes);
  }

  // Synapses
  stroke(255, 255, 255, 22);
  strokeWeight(0.8);
  for (let l = 0; l < layerPositions.length - 1; l++) {
    for (let src of layerPositions[l]) {
      for (let dst of layerPositions[l + 1]) {
        line(src.x, src.y, dst.x, dst.y);
      }
    }
  }

  // Neurones
  for (let l = 0; l < layerPositions.length; l++) {
    const isInput = (l === 0);
    const isOutput = (l === layerPositions.length - 1);

    for (let i = 0; i < layerPositions[l].length; i++) {
      const node = layerPositions[l][i];

      if (isInput && car.lastSensorReadings && car.lastSensorReadings[i]) {
        const val = car.lastSensorReadings[i].norm;
        fill(lerpColor(color('#10b981'), color('#ef4444'), val));
      } else if (isOutput) {
        fill(i === 0 ? '#f59e0b' : '#38bdf8');
      } else {
        fill(56, 189, 248);
      }

      stroke(255, 255, 255, 120);
      strokeWeight(1);
      circle(node.x, node.y, 7.5);
    }
  }

  noStroke();
  fill(245, 158, 11);
  textSize(9);
  const outNodes = layerPositions[layerPositions.length - 1];
  if (outNodes && outNodes[0]) text("Braquage", outNodes[0].x - 46, outNodes[0].y + 3);
  if (outNodes && outNodes[1]) {
    fill(56, 189, 248);
    text("Vitesse", outNodes[1].x - 34, outNodes[1].y + 3);
  }

  pop();
}

// Mise à jour des valeurs du panneau de télémétrie
function updateTelemetryDOM(bestCar) {
  const fpsEl = document.getElementById('val-fps');
  if (fpsEl && frameCount % 6 === 0) {
    fpsEl.textContent = `${Math.round(frameRate())} FPS`;
  }

  const genEl = document.getElementById('val-gen');
  if (genEl) genEl.textContent = generationCount;

  const aliveEl = document.getElementById('val-alive');
  if (aliveEl) {
    const totalCount = (currentMode === MODE_TIME_ATTACK) ? (playerCar ? 1 : 0) : currentConfig.populationSize;
    const currentAlive = (currentMode === MODE_TIME_ATTACK) ? (playerCar && !playerCar.crashed ? 1 : 0) : population.length;
    aliveEl.textContent = `${currentAlive} / ${totalCount}`;
  }

  const bestFitEl = document.getElementById('val-best-fit');
  if (bestFitEl) {
    const curFit = bestCar ? Math.round(bestCar.fitness) : (playerCar ? Math.round(playerCar.fitness) : 0);
    const histFit = (typeof historicalBestFitness !== 'undefined') ? historicalBestFitness : 0;
    bestFitEl.textContent = `${Math.max(curFit, histFit)} pts`;
  }

  const lapsEl = document.getElementById('val-laps');
  if (lapsEl) {
    const curLaps = (currentMode !== MODE_EVOLUTION && playerCar) ? playerCar.laps : (bestCar ? bestCar.laps : 0);
    const histLaps = (typeof historicalBestLaps !== 'undefined') ? historicalBestLaps : 0;
    const maxL = Math.max(curLaps, histLaps);
    lapsEl.textContent = `${maxL} tour${maxL > 1 ? 's' : ''}`;
  }
}

// Notification Toast flottante
let toastTimeout = null;
function showToast(message) {
  const banner = document.getElementById('toast-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    banner.classList.remove('show');
  }, 2800);
}

function toggleChaseCam() {
  isChaseCam = !isChaseCam;
  if (isChaseCam) {
    const target = (currentMode !== MODE_EVOLUTION && playerCar) ? playerCar : (population[0] || playerCar);
    if (target && target.pos) {
      camPos.x = target.pos.x;
      camPos.y = target.pos.y;
    }
  }
  updateQuickButtons();
  showToast(`🎥 Vue : ${isChaseCam ? 'POURSUITE' : 'AÉRIENNE'}`);
}

// Mise à jour de l'affichage des boutons rapides
function updateQuickButtons() {
  const btnCam = document.getElementById('btn-quick-cam');
  if (btnCam) {
    btnCam.textContent = isChaseCam ? "🎥 Vue : Poursuite" : "🎥 Vue : Aérienne";
    btnCam.classList.toggle('active', isChaseCam);
  }

  const btnAudio = document.getElementById('btn-quick-audio');
  if (btnAudio && typeof sounds !== 'undefined' && sounds) {
    btnAudio.textContent = sounds.isMuted ? "🔇 Son : OFF" : "🔊 Son : ON";
    btnAudio.classList.toggle('active', !sounds.isMuted);
  }

  const btnHaz = document.getElementById('btn-quick-hazards');
  if (btnHaz) {
    btnHaz.textContent = showHazards ? "⚠️ Obstacles : ON" : "⚠️ Obstacles : OFF";
    btnHaz.classList.toggle('active', showHazards);
  }
}

// Tentative de chargement du Ghost Champion depuis localStorage
function tryLoadGhostChampion() {
  if (typeof loadBestChampionFromStorage === 'function') {
    try {
      const brain = loadBestChampionFromStorage();
      const expectedInputs = (currentConfig.numSensors || 5) + (currentConfig.includeSpeedSensor ? 1 : 0);
      if (brain && brain.input_nodes === expectedInputs && start) {
        if (ghostChampion && ghostChampion.dispose) {
          try { ghostChampion.dispose(); } catch (e) {}
        }
        ghostChampion = new CarVehicle(brain, currentConfig);
        ghostChampion.pos.set(start.x, start.y);
        showToast("⭐ Ghost Champion IA chargé sur la piste !");
        return true;
      }
    } catch (e) {
      console.warn("Ghost non chargé:", e);
    }
  }
  return false;
}

// Liaison des onglets, curseurs et boutons
function bindUIControls() {
  // Onglets de mode
  const tabs = document.querySelectorAll('.mode-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-mode');
      setGameMode(mode);
    });
  });

  // Boutons rapides de la barre supérieure
  const btnQuickCam = document.getElementById('btn-quick-cam');
  if (btnQuickCam) {
    btnQuickCam.addEventListener('click', toggleChaseCam);
  }

  const btnQuickAudio = document.getElementById('btn-quick-audio');
  if (btnQuickAudio) {
    btnQuickAudio.addEventListener('click', () => {
      if (typeof sounds !== 'undefined' && sounds) sounds.toggleMute();
      updateQuickButtons();
    });
  }

  const btnQuickHaz = document.getElementById('btn-quick-hazards');
  if (btnQuickHaz) {
    btnQuickHaz.addEventListener('click', () => {
      showHazards = !showHazards;
      spawnHazards();
      updateQuickButtons();
    });
  }

  // Steering Behaviors Composables
  const chkSep = document.getElementById('chk-separation');
  if (chkSep) {
    chkSep.addEventListener('change', () => {
      hasSeparation = chkSep.checked;
    });
  }

  const chkDraft = document.getElementById('chk-drafting');
  if (chkDraft) {
    chkDraft.addEventListener('change', () => {
      if (playerCar) playerCar.draftBoost = chkDraft.checked ? 1.22 : 1.0;
    });
  }

  const chkHaz = document.getElementById('chk-hazards');
  if (chkHaz) {
    chkHaz.addEventListener('change', () => {
      showHazards = chkHaz.checked;
      spawnHazards();
      updateQuickButtons();
    });
  }

  const sliderSepDist = document.getElementById('slider-separation-dist');
  const lblSepDist = document.getElementById('lbl-separation-dist');
  if (sliderSepDist) {
    sliderSepDist.addEventListener('input', () => {
      separationDist = Number(sliderSepDist.value);
      if (lblSepDist) lblSepDist.textContent = `${separationDist} px`;
    });
  }

  // Sauvegarde et chargement du Champion IA
  const btnSaveChamp = document.getElementById('btn-save-champion');
  if (btnSaveChamp) {
    btnSaveChamp.addEventListener('click', () => {
      let best = population[0];
      for (let v of population) {
        if (v.fitness > (best ? best.fitness : -1)) best = v;
      }
      if (best && typeof saveBestChampionToStorage === 'function') {
        const ok = saveBestChampionToStorage(best);
        if (ok) {
          showToast(`💾 Champion sauvegardé (${Math.round(best.fitness)} pts) !`);
        }
      } else {
        showToast("⚠️ Aucune voiture active à sauvegarder.");
      }
    });
  }

  const btnLoadGhost = document.getElementById('btn-load-ghost');
  if (btnLoadGhost) {
    btnLoadGhost.addEventListener('click', () => {
      const ok = tryLoadGhostChampion();
      if (!ok) {
        showToast("ℹ️ Aucun champion sauvegardé pour l'instant. Entraînez une IA d'abord !");
      }
    });
  }

  const sync = (id, targetProp, labelId, formatFn, triggerReset = false) => {
    const el = document.getElementById(id);
    const lbl = document.getElementById(labelId);
    if (!el) return;

    el.addEventListener('input', () => {
      let val = el.type === 'checkbox' ? el.checked : Number(el.value);
      if (typeof formatFn === 'function') {
        currentConfig[targetProp] = val;
        if (lbl) lbl.textContent = formatFn(val);
      } else {
        currentConfig[targetProp] = val;
        if (lbl) lbl.textContent = val;
      }
      if (triggerReset) {
        resetPopulation();
      }
    });
  };

  // Réseau de neurones
  sync('slider-hidden-layers', 'numHiddenLayers', 'lbl-hidden-layers', v => `${v} couche${v > 1 ? 's' : ''}`, true);
  sync('slider-neurons-layer', 'neuronsPerLayer', 'lbl-neurons-layer', v => `${v}`, true);

  const actSelect = document.getElementById('select-activation');
  if (actSelect) {
    actSelect.addEventListener('change', () => {
      currentConfig.activation = actSelect.value;
      resetPopulation();
    });
  }

  const speedChk = document.getElementById('chk-speed-sensor');
  if (speedChk) {
    speedChk.addEventListener('change', () => {
      currentConfig.includeSpeedSensor = speedChk.checked;
      resetPopulation();
    });
  }

  // Capteurs
  sync('slider-sensors', 'numSensors', 'lbl-sensors', v => `${v} rayons`, true);
  sync('slider-fov', 'fov', 'lbl-fov', v => {
    currentConfig.fov = radians(v);
    return `${v}°`;
  }, true);
  sync('slider-sight', 'sight', 'lbl-sight', v => `${v} px`, true);

  // Dynamique véhicule
  sync('slider-maxspeed', 'maxspeed', 'lbl-maxspeed', v => `${v} px/f`);
  sync('slider-maxforce', 'maxforce', 'lbl-maxforce', v => `${v.toFixed(2)}`);

  // Génétique
  sync('slider-pop', 'populationSize', 'lbl-pop', v => `${v} voitures`, true);
  sync('slider-mutation', 'mutationRate', 'lbl-mutation', v => `${Math.round(v * 100)} %`);
  sync('slider-lifespan', 'lifespan', 'lbl-lifespan', v => `${v} frames`);
  sync('slider-elitism', 'elitismCount', 'lbl-elitism', v => `${v} champion${v > 1 ? 's' : ''}`);

  // Circuit
  const trackSlider = document.getElementById('slider-track-width');
  const trackLbl = document.getElementById('lbl-track-width');
  if (trackSlider) {
    trackSlider.addEventListener('input', () => {
      currentConfig.pathWidth = Number(trackSlider.value);
      if (trackLbl) trackLbl.textContent = `${currentConfig.pathWidth} px`;
      buildTrack(3.5, currentConfig.pathWidth);
    });
  }

  // Accélérateur temporel
  const speedSlider = document.getElementById('slider-speed');
  const speedLbl = document.getElementById('lbl-speed');
  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      simSpeed = Number(speedSlider.value);
      if (speedLbl) speedLbl.textContent = `x${simSpeed}`;
    });
  }

  // Boutons d'action
  const btnTurbo = document.getElementById('btn-turbo');
  if (btnTurbo) {
    btnTurbo.addEventListener('click', () => {
      isTurboMode = !isTurboMode;
      btnTurbo.textContent = `⚡ Mode Turbo : ${isTurboMode ? 'ON' : 'OFF'}`;
      btnTurbo.classList.toggle('active', isTurboMode);
    });
  }

  const btnBrainHUD = document.getElementById('btn-brain-hud');
  if (btnBrainHUD) {
    btnBrainHUD.addEventListener('click', () => {
      showBrainHUD = !showBrainHUD;
      btnBrainHUD.textContent = `🧠 HUD Cerveau : ${showBrainHUD ? 'ON' : 'OFF'}`;
      btnBrainHUD.classList.toggle('active', showBrainHUD);
    });
  }

  const btnDebug = document.getElementById('btn-debug');
  if (btnDebug) {
    btnDebug.addEventListener('click', () => {
      isDebugMode = !isDebugMode;
      btnDebug.textContent = `🔍 Mode Debug : ${isDebugMode ? 'ON' : 'OFF'} (D)`;
      btnDebug.classList.toggle('active', isDebugMode);
    });
  }

  const btnPreset = document.getElementById('btn-perfect-preset');
  if (btnPreset) {
    btnPreset.addEventListener('click', applyPerfectPreset);
  }

  const btnNewTrack = document.getElementById('btn-new-track');
  if (btnNewTrack) {
    btnNewTrack.addEventListener('click', () => {
      buildTrack();
      resetPopulation();
      showToast("🎲 Nouveau circuit généré !");
    });
  }

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      resetPopulation();
      showToast("🔄 Population réinitialisée !");
    });
  }

  // Panneau repliable
  const toggleBtn = document.getElementById('toggle-panel-btn');
  const closeBtn = document.getElementById('btn-close-panel');
  const panel = document.getElementById('control-panel');

  const togglePanel = () => {
    if (panel) panel.classList.toggle('hidden');
  };

  if (toggleBtn) toggleBtn.addEventListener('click', togglePanel);
  if (closeBtn) closeBtn.addEventListener('click', togglePanel);
}

// Preset parfait universel garantissant la réussite
function applyPerfectPreset() {
  currentConfig = {
    numSensors: 7,
    fov: radians(115),
    sight: 140,
    maxspeed: 6.5,
    maxforce: 0.32,
    numHiddenLayers: 2,
    neuronsPerLayer: 14,
    hiddenLayers: [14, 14],
    activation: 'tanh',
    includeSpeedSensor: true,
    populationSize: 50,
    mutationRate: 0.08,
    lifespan: 50,
    elitismCount: 2,
    pathWidth: 60
  };

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

  setVal('slider-hidden-layers', 2); setTxt('lbl-hidden-layers', '2 couches');
  setVal('slider-neurons-layer', 14); setTxt('lbl-neurons-layer', '14');
  setVal('select-activation', 'tanh');
  setChk('chk-speed-sensor', true);

  setVal('slider-sensors', 7); setTxt('lbl-sensors', '7 rayons');
  setVal('slider-fov', 115); setTxt('lbl-fov', '115°');
  setVal('slider-sight', 140); setTxt('lbl-sight', '140 px');

  setVal('slider-maxspeed', 6.5); setTxt('lbl-maxspeed', '6.5 px/f');
  setVal('slider-maxforce', 0.32); setTxt('lbl-maxforce', '0.32');

  setVal('slider-pop', 50); setTxt('lbl-pop', '50 voitures');
  setVal('slider-mutation', 0.08); setTxt('lbl-mutation', '8 %');
  setVal('slider-lifespan', 50); setTxt('lbl-lifespan', '50 frames');
  setVal('slider-elitism', 2); setTxt('lbl-elitism', '2 champions');
  setVal('slider-track-width', 60); setTxt('lbl-track-width', '60 px');

  buildTrack(3.5, 60);
  resetPopulation();
  showToast("⭐ Réglages parfaits universels appliqués !");
}

// Gestion des touches du joueur (ZQSD et Flèches)
function bindKeyboardListeners() {
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.matches('input, select, textarea')) return;

    const k = e.key.toLowerCase();
    const drivingKeys = ['z', 'w', 's', 'q', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    if (drivingKeys.includes(k) || drivingKeys.includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    if (k === 'z' || k === 'w' || e.key === 'ArrowUp') keysPressed.up = true;
    if (k === 's' || e.key === 'ArrowDown') keysPressed.down = true;
    if (k === 'q' || k === 'a' || e.key === 'ArrowLeft') keysPressed.left = true;
    if (k === 'd' || e.key === 'ArrowRight') keysPressed.right = true;
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'w' || e.key === 'ArrowUp') keysPressed.up = false;
    if (k === 's' || e.key === 'ArrowDown') keysPressed.down = false;
    if (k === 'q' || k === 'a' || e.key === 'ArrowLeft') keysPressed.left = false;
    if (k === 'd' || e.key === 'ArrowRight') keysPressed.right = false;
  });
}

// Raccourcis clavier globaux
function keyPressed() {
  if (document.activeElement && document.activeElement.matches('input, select, textarea')) return;

  const k = key.toLowerCase();
  if (k === '1' || k === '&') {
    setGameMode(MODE_EVOLUTION);
  } else if (k === '2' || k === 'é') {
    setGameMode(MODE_RACE);
  } else if (k === '3' || k === '"') {
    setGameMode(MODE_TIME_ATTACK);
  } else if (k === 'v') {
    toggleChaseCam();
  } else if (k === 'm') {
    if (typeof sounds !== 'undefined' && sounds) sounds.toggleMute();
    updateQuickButtons();
    showToast(sounds && sounds.isMuted ? "🔇 Audio coupé" : "🔊 Audio activé");
  } else if (k === 'o') {
    showHazards = !showHazards;
    spawnHazards();
    updateQuickButtons();
    showToast(showHazards ? "⚠️ Obstacles & flaques activés" : "⚠️ Obstacles désactivés");
  } else if (k === 'x' || (k === 'd' && currentMode === MODE_EVOLUTION)) {
    isDebugMode = !isDebugMode;
    const btn = document.getElementById('btn-debug');
    if (btn) {
      btn.textContent = `🔍 Mode Debug : ${isDebugMode ? 'ON' : 'OFF'} (D/X)`;
      btn.classList.toggle('active', isDebugMode);
    }
  } else if (k === 'h') {
    const panel = document.getElementById('control-panel');
    if (panel) panel.classList.toggle('hidden');
  } else if (k === 'b') {
    buildTrack();
    resetPopulation();
  } else if (k === 'l') {
    showRacingLine = !showRacingLine;
    showToast(showRacingLine ? "🟢 Trajectoire idéale F1 : ACTIVÉE (L)" : "⚪ Trajectoire idéale F1 : DÉSACTIVÉE (L)");
  } else if (k === 'c') {
    if (currentMode !== MODE_EVOLUTION && playerCar && typeof playerCar.cycleLivery === 'function') {
      const liv = playerCar.cycleLivery();
      showToast(`🎨 Livrée joueur : ${liv.name} (C)`);
    } else {
      const btn = document.getElementById('btn-brain-hud');
      if (btn) btn.click();
    }
  } else if (k === 'r') {
    if (currentMode === MODE_RACE) {
      startRaceCountdown();
      showToast("🏁 Revanche Grand Prix lancée !");
    } else if (currentMode === MODE_TIME_ATTACK) {
      setGameMode(MODE_TIME_ATTACK);
      showToast("⏱️ Chronomètre Solo réinitialisé !");
    } else {
      resetPopulation();
      showToast("🔄 Flotte IA réinitialisée !");
    }
  } else if (k === 't') {
    const btn = document.getElementById('btn-turbo');
    if (btn) btn.click();
  } else if (key === ' ') {
    isPaused = !isPaused;
  }
}