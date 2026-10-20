import test from 'node:test';
import assert from 'node:assert/strict';

// Helper mock pour les vecteurs 2D de p5
class MockVector {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y) { this.x = x; this.y = y; return this; }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  mult(n) { this.x *= n; this.y *= n; return this; }
  div(n) { this.x /= n; this.y /= n; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  heading() { return Math.atan2(this.y, this.x); }
  normalize() {
    const m = this.mag();
    if (m > 0) this.div(m);
    return this;
  }
  setMag(m) { return this.normalize().mult(m); }
  limit(max) {
    if (this.mag() > max) this.setMag(max);
    return this;
  }
  copy() { return new MockVector(this.x, this.y); }
  static dist(v1, v2) { return Math.hypot(v1.x - v2.x, v1.y - v2.y); }
  static fromAngle(angle) { return new MockVector(Math.cos(angle), Math.sin(angle)); }
  static sub(v1, v2) { return new MockVector(v1.x - v2.x, v1.y - v2.y); }
}

globalThis.p5 = { Vector: MockVector };
globalThis.createVector = (x, y) => new MockVector(x, y);

// Importation et enregistrement de NeuralNetwork
import { NeuralNetwork } from '../nn.js';
globalThis.NeuralNetwork = NeuralNetwork;

// Définition de base pour Boundary et Ray dans l'environnement de test
class Boundary {
  constructor(x1, y1, x2, y2) {
    this.a = createVector(x1, y1);
    this.b = createVector(x2, y2);
  }
  midpoint() {
    return createVector((this.a.x + this.b.x) * 0.5, (this.a.y + this.b.y) * 0.5);
  }
}

class Ray {
  constructor(pos, angle) {
    this.pos = pos;
    this.angle = angle;
    this.dir = MockVector.fromAngle(angle);
  }
  rotate(offset) {
    this.dir = MockVector.fromAngle(this.angle + offset);
  }
  cast(wall) {
    const x1 = wall.a.x, y1 = wall.a.y;
    const x2 = wall.b.x, y2 = wall.b.y;
    const x3 = this.pos.x, y3 = this.pos.y;
    const x4 = this.pos.x + this.dir.x, y4 = this.pos.y + this.dir.y;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    if (t > 0 && t < 1 && u > 0) {
      return createVector(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
    }
    return null;
  }
}

globalThis.Boundary = Boundary;
globalThis.Ray = Ray;

// Mock de base pour Vehicle
class Vehicle {
  constructor() {
    this.pos = createVector(0, 0);
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
  }
  applyForce(force) {
    this.acc.add(force);
  }
}
globalThis.Vehicle = Vehicle;

// Importation dynamique des modules dépendant des globales
const { CarVehicle } = await import('../car.js');
const { PlayerCar, PLAYER_LIVERIES } = await import('../playerCar.js');
const { Hazard } = await import('../hazard.js');
const { nextGeneration, calculateFitnessForAllCars, saveBestChampionToStorage, loadBestChampionFromStorage } = await import('../ga.js');
globalThis.CarVehicle = CarVehicle;
globalThis.PlayerCar = PlayerCar;
globalThis.Hazard = Hazard;

test('1. NeuralNetwork: supporte les architectures multi-couches et différentes activations', () => {
  const nn = new NeuralNetwork(5, [8, 6], 2, 'tanh');
  const topology = nn.getTopology();

  assert.equal(topology.inputNodes, 5);
  assert.deepEqual(topology.hiddenLayers, [8, 6]);
  assert.equal(topology.outputNodes, 2);
  assert.equal(topology.activation, 'tanh');

  const outputs = nn.predict([0.2, 0.5, 0.9, 0.1, 0.4]);
  assert.equal(outputs.length, 2);
  assert.ok(outputs[0] >= 0 && outputs[0] <= 1);
  assert.ok(outputs[1] >= 0 && outputs[1] <= 1);
});

test('2. NeuralNetwork: copy() clone les poids et mutate() modifie les valeurs', () => {
  const nn = new NeuralNetwork(4, [8], 2, 'relu');
  const clone = nn.copy();
  const input = [0.1, 0.8, 0.3, 0.5];

  const out1 = nn.predict(input);
  const outClone = clone.predict(input);
  assert.deepEqual(out1, outClone);

  clone.mutate(1.0); // 100% de taux de mutation
  const outMutated = clone.predict(input);
  // Au moins une sortie doit être perturbée
  const diff = Math.abs(out1[0] - outMutated[0]) + Math.abs(out1[1] - outMutated[1]);
  assert.ok(diff > 0.0001);
});

test('3. Raycasting: détection précise de l intersection avec un mur Boundary', () => {
  const wall = new Boundary(100, -50, 100, 50); // Mur vertical en x = 100
  const ray = new Ray(createVector(0, 0), 0);   // Rayon horizontal vers la droite

  const hit = ray.cast(wall);
  assert.ok(hit !== null);
  assert.equal(Math.round(hit.x), 100);
  assert.equal(Math.round(hit.y), 0);

  // Rayon vers la gauche ne doit pas toucher le mur à droite
  const rayOpposite = new Ray(createVector(0, 0), Math.PI);
  assert.equal(rayOpposite.cast(wall), null);
});

test('4. CarVehicle: configure le nombre de capteurs et l angle FOV', () => {
  const config = {
    numSensors: 7,
    fov: Math.PI, // 180°
    sight: 150,
    maxspeed: 8,
    maxforce: 0.35
  };
  const car = new CarVehicle(null, config);

  assert.equal(car.rays.length, 7);
  assert.equal(car.sight, 150);
  assert.equal(car.maxspeed, 8);
  assert.equal(car.maxforce, 0.35);

  // Premier et dernier rayon aux extrémités du FOV (-90° et +90°)
  assert.ok(Math.abs(car.rays[0].angle - (-Math.PI / 2)) < 1e-5);
  assert.ok(Math.abs(car.rays[6].angle - (Math.PI / 2)) < 1e-5);
});

test('5. CarVehicle: force de pilotage conforme au modèle Reynolds et limitée à maxforce', () => {
  const car = new CarVehicle(null, { maxforce: 0.25, maxspeed: 6 });
  car.vel.set(2, 0);

  const wall = new Boundary(50, -50, 50, 50);
  const force = car.look([wall]);

  assert.ok(force.mag() <= car.maxforce + 1e-6);
  assert.ok(Number.isFinite(force.x) && Number.isFinite(force.y));
});

test('6. CarVehicle: franchissement de checkpoints et calcul de fitness continu', () => {
  const car = new CarVehicle(null, {});
  const cp1 = new Boundary(50, -20, 50, 20);
  const cp2 = new Boundary(100, -20, 100, 20);
  const checkpoints = [cp1, cp2];

  car.pos.set(48, 0); // Très proche du checkpoint 1
  car.check(checkpoints);
  assert.equal(car.fitness, 1);
  assert.equal(car.index, 1);

  car.calculateFitness();
  assert.ok(car.fitnessScore > 1.0); // Fitness supérieure à 1 grâce au bonus de proximité
});

test('7. CarVehicle: détection de collision mortelle et expiration de durée de vie', () => {
  const car = new CarVehicle(null, { lifespan: 3 });
  car.pos.set(0, 0);
  assert.equal(car.dead, false);

  // Écoulement du lifespan sans franchir de checkpoint
  car.update(); // 1
  car.update(); // 2
  car.update(); // 3
  car.update(); // 4 > 3
  assert.equal(car.dead, true);
});

test('8. Algorithme Génétique: calculateFitnessForAllCars protège contre NaN sur fitness nulle', () => {
  const car1 = new CarVehicle(null, {});
  const car2 = new CarVehicle(null, {});
  car1.fitness = 0;
  car2.fitness = 0;

  globalThis.savedVehicles = [car1, car2];
  calculateFitnessForAllCars();

  assert.equal(car1.normalizedFitness, 0.5);
  assert.equal(car2.normalizedFitness, 0.5);
  assert.ok(!Number.isNaN(car1.normalizedFitness));
});

test('9. Algorithme Génétique: élitisme préserve les champions sans mutation', () => {
  const championBrain = new NeuralNetwork(5, [8], 2, 'tanh');
  const champion = new CarVehicle(championBrain, {});
  champion.fitness = 500;

  const weak = new CarVehicle(null, {});
  weak.fitness = 10;

  globalThis.savedVehicles = [champion, weak];
  globalThis.population = [];
  globalThis.generationCount = 0;
  globalThis.TOTAL = 10;

  nextGeneration({
    populationSize: 10,
    elitismCount: 1,
    mutationRate: 0.1
  });

  assert.equal(globalThis.population.length, 10);
  // Le premier membre est l'élite
  assert.equal(globalThis.population[0].isElite, true);
});

test('10. Mode Debug et Réglages Parfaits: car.show(false, true) supporte le mode debug sans recalcul de forces', () => {
  const car = new CarVehicle(null, {
    numSensors: 7,
    fov: Math.PI * 0.64,
    sight: 140,
    maxspeed: 6.5,
    maxforce: 0.32,
    hiddenLayers: [14, 14],
    activation: 'tanh',
    includeSpeedSensor: true
  });

  assert.equal(car.rays.length, 7);
  assert.equal(car.sight, 140);
  assert.equal(car.maxspeed, 6.5);
  assert.equal(car.maxforce, 0.32);
  assert.equal(car.includeSpeedSensor, true);
  assert.equal(car.brain.input_nodes, 8); // 7 rayons + 1 capteur de vitesse

  // Vérifie que show en mode debug s'exécute sans erreur
  assert.doesNotThrow(() => {
    car.show(false, true);
    car.highlight(true);
  });
});

test('11. PlayerCar: hérite de Vehicle, applique les forces Reynolds pour l accélération et le freinage', () => {
  const player = new PlayerCar(100, 100, { maxspeed: 7.0, maxforce: 0.5 });
  assert.ok(player instanceof Vehicle);
  assert.equal(player.pos.x, 100);
  assert.equal(player.pos.y, 100);

  // Accélération vers l'avant (Touche Haut)
  player.handleInput({ up: true, down: false, left: false, right: false });
  assert.ok(player.acc.mag() > 0, "L'accélération doit appliquer une force motrice");
  assert.ok(player.acc.mag() <= 0.5001, "La force ne doit pas excéder maxForce");

  // Déplacement et mise à jour
  player.update();
  assert.ok(player.vel.mag() > 0, "La vitesse doit augmenter suite à la force motrice");
  assert.ok(player.pos.x > 100, "Le véhicule avance sur l'axe X");

  // Freinage actif (Touche Bas)
  const speedBeforeBrake = player.vel.mag();
  player.handleInput({ up: false, down: true, left: false, right: false });
  assert.ok(player.acc.x < 0, "Le freinage doit exercer une force opposée à la trajectoire");
});

test('12. PlayerCar: chronométrage F1 des tours et enregistrement des checkpoints', () => {
  const player = new PlayerCar(0, 0);
  const cp1 = new Boundary(-10, 0, 10, 0); // Checkpoint à l'origine
  const cp2 = new Boundary(100, -10, 100, 10);

  // Le joueur passe le premier checkpoint
  player.check([cp1, cp2]);
  assert.equal(player.fitness, 1);
  assert.equal(player.index, 1);

  // Le joueur passe le 2ème checkpoint
  player.pos.set(100, 0);
  player.check([cp1, cp2]);
  assert.equal(player.fitness, 2);
  assert.equal(player.index, 0);
  assert.equal(player.laps, 1, "Un tour complet doit être validé");
});

test('13. Steering Behavior Séparation (7-Boids): repousse les voitures trop proches', () => {
  const carA = new CarVehicle(null, { maxforce: 0.3 });
  carA.pos.set(100, 100);
  carA.vel.set(2, 0);

  const carB = new CarVehicle(null, { maxforce: 0.3 });
  carB.pos.set(108, 100); // Très proche de carA (distance 8px < 24px)
  carB.vel.set(2, 0);

  const sepForce = carA.separate([carB], 24);
  assert.ok(sepForce, "Une force de séparation doit être générée");
  assert.ok(sepForce.x < 0, "carA doit être repoussée vers la gauche à l'opposé de carB");
  assert.ok(Math.hypot(sepForce.x, sepForce.y) <= carA.maxforce * 1.25, "La force de séparation respecte la limite maxforce");
});

test('14. Steering Behavior Aspiration (Slipstream): vitesse max augmentée de 20% et pull force', () => {
  const leader = new CarVehicle(null, {});
  leader.pos.set(150, 100);
  leader.vel.set(4, 0);

  const follower = new CarVehicle(null, { maxspeed: 6.0, maxforce: 0.3 });
  follower.pos.set(110, 100); // 40px derrière leader, aligné sur son sillage
  follower.vel.set(4, 0);

  follower.checkDrafting([leader]);
  assert.equal(follower.isDrafting, true, "L'aspiration doit être détectée dans le sillage");
  assert.equal(follower.draftBoost, 1.20, "Le boost de vitesse max doit être de 20%");
  assert.ok(follower.acc.x > 0, "Une impulsion d'aspiration avant doit être appliquée");
});

test('15. Hazard: hérite de Vehicle et applique la déstabilisation spinOut lors de la collision', () => {
  const oil = new Hazard(200, 200, 'oil', 20);
  assert.ok(oil instanceof Vehicle, "Hazard doit hériter de Vehicle");

  const player = new PlayerCar(205, 205);
  player.vel.set(5, 0);

  const hit = oil.checkCollision(player);
  assert.equal(hit, true, "La collision avec la flaque d'huile doit être détectée");
  assert.equal(player.isSpinning, true, "La voiture doit entrer en tête-à-queue / perte d'adhérence");
  assert.ok(player.vel.mag() < 5, "La flaque d'huile réduit la vitesse et fait dériver le véhicule");
});

test('16. Champion Neural Network Storage: serialize() et deserialize() préservent les paramètres', () => {
  const originalNN = new NeuralNetwork(6, [12, 10], 2, 'tanh');
  const serialized = originalNN.serialize();
  assert.ok(typeof serialized === 'string');
  assert.ok(serialized.includes('"inputNodes":6'));

  const restoredNN = NeuralNetwork.deserialize(serialized);
  assert.equal(restoredNN.input_nodes, 6);
  assert.deepEqual(restoredNN.hidden_layers, [12, 10]);
  assert.equal(restoredNN.output_nodes, 2);
  assert.equal(restoredNN.activation, 'tanh');

  // Les prédictions doivent être identiques
  const testInput = [0.1, 0.4, 0.7, 0.2, 0.9, 0.5];
  const out1 = originalNN.predict(testInput);
  const out2 = restoredNN.predict(testInput);
  assert.equal(out1[0].toFixed(5), out2[0].toFixed(5));
  assert.equal(out1[1].toFixed(5), out2[1].toFixed(5));
});

test('17. PlayerCar: checkWalls utilise la distance exacte au segment évitant les faux crashs de droites infinies', () => {
  const player = new PlayerCar(50, 0);
  assert.equal(player.crashed, false);

  // Mur lointain mais collinéaire (sur la même droite y = 0, entre x=200 et x=300)
  // Une fonction d'intersection de droite infinie donnerait une distance de 0 !
  const distantCollinearWall = new Boundary(200, 0, 300, 0);
  player.checkWalls([distantCollinearWall]);
  assert.equal(player.crashed, false, "Le mur lointain ne doit pas provoquer de fausse collision");

  // Mur réel au contact (à 4px du véhicule, < 8px)
  const contactWall = new Boundary(45, 4, 55, 4);
  player.checkWalls([contactWall]);
  assert.equal(player.crashed, true, "Le mur réel au contact doit déclencher le crash");
  assert.equal(player.crashTimer, 30);
});

test('18. PlayerCar: respawn() restaure le véhicule sans boucle de crash infinie', () => {
  const player = new PlayerCar(50, 50);
  player.triggerCrash();
  assert.equal(player.crashed, true);

  player.respawn();
  assert.equal(player.crashed, false);
  assert.equal(player.crashTimer, 0);
  assert.equal(player.vel.x, 0);
  assert.equal(player.vel.y, 0);
  assert.equal(player.pos.x, 50);
  assert.equal(player.pos.y, 50);
});

test('19. PlayerCar: braquage maniable aux touches ZQSD et flèches même à vitesse nulle', () => {
  const player = new PlayerCar(0, 0);
  const initialAngle = player.headingAngle;

  // Braquage à gauche à l'arrêt
  player.handleInput({ up: false, down: false, left: true, right: false });
  assert.ok(player.headingAngle < initialAngle, "La direction doit tourner à gauche même à l'arrêt");

  // Braquage à droite
  const angleAfterLeft = player.headingAngle;
  player.handleInput({ up: false, down: false, left: false, right: true });
  player.handleInput({ up: false, down: false, left: false, right: true });
  assert.ok(player.headingAngle > angleAfterLeft, "La direction doit tourner à droite");
});

test('20. CarVehicle: driverProfile configure les paramètres Reynolds et gère les collisions sans mort permanente en mode course', () => {
  const profile = {
    name: "Max",
    title: "Légende",
    skill: 1.0,
    maxspeed: 5.3,
    maxforce: 0.30,
    steerRate: 0.080,
    lookAhead: 2
  };
  const ai = new CarVehicle(null, {
    driverProfile: profile,
    isRaceMode: true,
    lifespan: 5
  });

  assert.equal(ai.maxspeed, 5.3);
  assert.equal(ai.maxforce, 0.30);
  assert.equal(ai.driverProfile.name, "Max");

  // En mode course avec mur proche (< 6px), le véhicule ne meurt pas définitivement
  const contactWall = new Boundary(3, -50, 3, 50);
  ai.look([contactWall]);
  assert.equal(ai.dead, false, "En mode course, l'IA ne doit pas disparaître lors d'un choc contre un mur");
  assert.equal(ai.isSpinning, true, "Un choc doit déclencher la rotation et la pénalité de récupération");

  // L'inactivité (lifespan) ne doit pas tuer les concurrents en mode course
  for (let i = 0; i < 10; i++) {
    ai.update();
  }
  assert.equal(ai.dead, false, "Le timeout de lifespan ne doit pas tuer les bolides en mode course");
});

test('21. Profils IA de course: hiérarchie de niveaux variée du Débutant au Champion', () => {
  const rookieProfile = { name: "Rookie", skill: 0.32, maxspeed: 3.2, maxforce: 0.17 };
  const championProfile = { name: "Max", skill: 1.00, maxspeed: 5.3, maxforce: 0.30 };

  const rookie = new CarVehicle(null, { driverProfile: rookieProfile, isRaceMode: true });
  const champion = new CarVehicle(null, { driverProfile: championProfile, isRaceMode: true });

  assert.ok(champion.maxspeed > rookie.maxspeed, "Le champion doit être plus rapide que le rookie");
  assert.ok(champion.maxforce > rookie.maxforce, "Le champion doit avoir une force de propulsion supérieure");
  assert.ok(champion.driverProfile.skill > rookie.driverProfile.skill, "Le niveau de compétence du champion doit surpasser le rookie");
});

test('22. PlayerCar: personnalisation des livrees (cycleLivery) et persistance des couleurs RGB', () => {
  const player = new PlayerCar(0, 0);
  assert.ok(PLAYER_LIVERIES && PLAYER_LIVERIES.length >= 6);
  assert.equal(player.liveryIndex, 0);
  assert.equal(player.livery.name, 'Cyan Néon');

  const nextLivery = player.cycleLivery();
  assert.equal(player.liveryIndex, 1);
  assert.equal(nextLivery.name, 'Rouge Écarlate');
  assert.deepEqual(nextLivery.rgb, [239, 68, 68]);

  for (let i = 0; i < PLAYER_LIVERIES.length - 1; i++) {
    player.cycleLivery();
  }
  assert.equal(player.liveryIndex, 0);
  assert.equal(player.livery.name, 'Cyan Néon');
});

test('23. PlayerCar: traces de pneus doubles (dual skid marks) et particules de fumee lors du drift', () => {
  const player = new PlayerCar(100, 100);
  assert.ok(Array.isArray(player.skidMarks));
  assert.ok(Array.isArray(player.smokeParticles));

  player.vel = { x: 4.5, y: 0, mag: () => 4.5, heading: () => 0 };
  player.headingAngle = Math.PI * 0.25;

  player.update();

  assert.ok(player.skidMarks.length >= 1, 'Le derapage doit enregistrer des points de traces de pneus doubles');
  const firstSkid = player.skidMarks[0];
  assert.ok(firstSkid.left && firstSkid.right, 'Chaque trace doit avoir une coordonnee pour la roue gauche et droite');
  assert.ok(player.smokeParticles.length >= 1, 'Le derapage doit emettre des particules de fumee');
  assert.ok(player.smokeParticles[0].life > 0);
});
