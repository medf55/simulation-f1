/**
 * Algorithme génétique haute performance avec élitisme, sélection par roulette
 * sécurisée (sans risque de division par zéro ou NaN) et gestion propre de la mémoire TensorFlow.
 */

let ELITISM_COUNT = 2; // Nombre de champions préservés intacts d'une génération à l'autre
let historicalBestFitness = 0;
let historicalBestLaps = 0;

function nextGeneration(config = {}) {
  // 1. Calcul et normalisation des scores de fitness
  calculateFitnessForAllCars();

  const newPopulation = [];
  const popSize = config.populationSize || (typeof TOTAL !== 'undefined' ? TOTAL : 50);
  const mutationRate = config.mutationRate !== undefined ? config.mutationRate : (typeof MUTATION_RATE !== 'undefined' ? MUTATION_RATE : 0.1);
  const eliteCount = Math.min(config.elitismCount !== undefined ? config.elitismCount : ELITISM_COUNT, savedVehicles.length);
  const CarClass = (typeof CarVehicle !== 'undefined') ? CarVehicle : (typeof window !== 'undefined' ? window.CarVehicle : globalThis.CarVehicle);

  // 2. ÉLITISME : Préservation des N meilleurs pilotes sans mutation
  for (let i = 0; i < eliteCount; i++) {
    const eliteParent = savedVehicles[i];
    if (eliteParent && eliteParent.brain && CarClass) {
      const eliteChild = new CarClass(eliteParent.brain, config);
      eliteChild.isElite = true;
      newPopulation.push(eliteChild);
    }
  }

  // 3. REPRODUCTION & MUTATION pour compléter la population
  while (newPopulation.length < popSize) {
    const parent = pickOne();
    if (parent && parent.brain && CarClass) {
      const child = new CarClass(parent.brain, config);
      child.mutate(mutationRate);
      newPopulation.push(child);
    } else if (CarClass) {
      // En cas de secours, nouvelle voiture initialisée
      newPopulation.push(new CarClass(null, config));
    }
  }

  // 4. Nettoyage mémoire de tous les anciens modèles TensorFlow
  for (let vehicle of savedVehicles) {
    vehicle.dispose();
  }
  savedVehicles = [];

  // 5. Mise à jour de la population active
  population = newPopulation;
  generationCount++;
}

// Sélection par roulette proportionnelle à la fitness (Roulette Wheel Selection)
function pickOne() {
  if (!savedVehicles || savedVehicles.length === 0) return null;

  let r = Math.random();
  let index = 0;

  while (r > 0 && index < savedVehicles.length) {
    r -= (savedVehicles[index].normalizedFitness || 0);
    index++;
  }
  index = Math.max(0, Math.min(index - 1, savedVehicles.length - 1));

  return savedVehicles[index];
}

// Calcul et normalisation sécurisée des scores
function calculateFitnessForAllCars() {
  if (!savedVehicles || savedVehicles.length === 0) return;

  // Calcul du score individuel
  for (let vehicle of savedVehicles) {
    vehicle.calculateFitness();
  }

  // Tri décroissant pour faciliter l'élitisme et les statistiques
  savedVehicles.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));

  // Mise à jour des records historiques
  if (savedVehicles[0]) {
    const bestCurrent = savedVehicles[0].fitness || 0;
    if (bestCurrent > historicalBestFitness) {
      historicalBestFitness = Math.round(bestCurrent);
    }
    const lapsCurrent = savedVehicles[0].laps || 0;
    if (lapsCurrent > historicalBestLaps) {
      historicalBestLaps = lapsCurrent;
    }
  }

  // Somme totale pour normalisation
  let sum = 0;
  for (let vehicle of savedVehicles) {
    sum += (vehicle.fitness || 0);
  }

  // Sécurité anti-division par zéro / NaN
  if (sum <= 0 || !Number.isFinite(sum)) {
    const equalShare = 1 / savedVehicles.length;
    for (let vehicle of savedVehicles) {
      vehicle.normalizedFitness = equalShare;
    }
  } else {
    for (let vehicle of savedVehicles) {
      vehicle.normalizedFitness = (vehicle.fitness || 0) / sum;
    }
  }
}

// Persistance localStorage du meilleur champion
function saveBestChampionToStorage(car) {
  if (!car || !car.brain || typeof car.brain.serialize !== 'function') return false;
  try {
    const data = car.brain.serialize();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('f1_ai_best_champion', data);
      localStorage.setItem('f1_ai_best_fitness', Math.round(car.fitness || 0).toString());
      localStorage.setItem('f1_ai_best_laps', (car.laps || 0).toString());
      return true;
    }
  } catch (e) {
    console.warn("Impossible de sauvegarder dans localStorage:", e);
  }
  return false;
}

function loadBestChampionFromStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      const data = localStorage.getItem('f1_ai_best_champion');
      if (data && typeof NeuralNetwork !== 'undefined' && typeof NeuralNetwork.deserialize === 'function') {
        const brain = NeuralNetwork.deserialize(data);
        return brain;
      }
    }
  } catch (e) {
    console.warn("Impossible de charger depuis localStorage:", e);
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nextGeneration,
    pickOne,
    calculateFitnessForAllCars,
    saveBestChampionToStorage,
    loadBestChampionFromStorage,
    getHistoricalStats: () => ({ historicalBestFitness, historicalBestLaps })
  };
} else {
  globalThis.saveBestChampionToStorage = saveBestChampionToStorage;
  globalThis.loadBestChampionFromStorage = loadBestChampionFromStorage;
}