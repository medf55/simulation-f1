var BaseVehicle = (typeof Vehicle !== 'undefined') ? Vehicle : class {
  constructor(brain) {}
  applyForce(force) {}
};
globalThis.BaseVehicle = BaseVehicle;

const getNNClass = () => {
  if (typeof NeuralNetwork !== 'undefined') return NeuralNetwork;
  if (typeof globalThis !== 'undefined' && globalThis.NeuralNetwork) return globalThis.NeuralNetwork;
  return null;
};

const getRayClass = () => {
  if (typeof Ray !== 'undefined') return Ray;
  if (typeof globalThis !== 'undefined' && globalThis.Ray) return globalThis.Ray;
  return null;
};

class CarVehicle extends BaseVehicle {
  constructor(brain, config = {}) {
    super(brain);

    // Paramètres configurables depuis l'interface
    this.numSensors = config.numSensors || 5;
    this.fov = config.fov !== undefined ? config.fov : (Math.PI * 0.6); // ~108°
    this.sight = config.sight || 120;
    this.maxspeed = config.maxspeed || 6;
    this.maxforce = config.maxforce || 0.28;
    this.lifespan = config.lifespan || 45;
    this.includeSpeedSensor = config.includeSpeedSensor || false;
    this.hiddenLayers = config.hiddenLayers || [10];
    this.activation = config.activation || 'tanh';

    // Profil de pilote et mode de jeu
    this.driverProfile = config.driverProfile || null;
    this.isRaceMode = config.isRaceMode || false;
    if (this.driverProfile) {
      if (this.driverProfile.maxspeed) this.maxspeed = this.driverProfile.maxspeed;
      if (this.driverProfile.maxforce) this.maxforce = this.driverProfile.maxforce;
    }

    // Position initiale
    if (typeof start !== 'undefined' && start) {
      this.pos = (typeof createVector === 'function') ? createVector(start.x, start.y) : { x: start.x, y: start.y };
    } else if (config.startX !== undefined && config.startY !== undefined) {
      this.pos = (typeof createVector === 'function') ? createVector(config.startX, config.startY) : { x: config.startX, y: config.startY };
    }

    this.vel = (typeof createVector === 'function') ? createVector(0, 0) : { x: 0, y: 0 };
    this.acc = (typeof createVector === 'function') ? createVector(0, 0) : { x: 0, y: 0 };
    this.fitness = 0;
    this.fitnessScore = 0;
    this.counter = 0;
    this.index = 0;
    this.laps = 0;
    this.dead = false;
    this.finished = false;
    this.lastSensorReadings = [];

    this.isDrafting = false;
    this.draftBoost = 1.0;
    this.draftTarget = null;
    this.isSpinning = false;
    this.spinTimer = 0;

    // Création des rayons de perception paramétrables
    this.initRays();

    // Initialisation du cerveau (réseau de neurones)
    this.initBrain(brain);
  }

  initRays() {
    this.rays = [];
    const RayConstructor = getRayClass();
    if (!RayConstructor) return;

    if (this.numSensors <= 1) {
      this.rays.push(new RayConstructor(this.pos, 0));
      return;
    }

    const startAngle = -this.fov / 2;
    const step = this.fov / (this.numSensors - 1);
    for (let i = 0; i < this.numSensors; i++) {
      const angle = startAngle + i * step;
      this.rays.push(new RayConstructor(this.pos, angle));
    }
  }

  initBrain(brain) {
    if (this.brain && typeof this.brain.dispose === 'function') {
      try { this.brain.dispose(); } catch (e) {}
    }
    if (brain) {
      this.brain = brain.copy();
    } else {
      const NNConstructor = getNNClass();
      if (!NNConstructor) return;
      const inputCount = this.rays.length + (this.includeSpeedSensor ? 1 : 0);
      const outputCount = 2; // [0: braquage de direction, 1: contrôle d'accélération/vitesse]
      this.brain = new NNConstructor(inputCount, this.hiddenLayers, outputCount, this.activation);
    }
  }

  applyForce(force) {
    if (!force) return;
    const fx = (typeof force.x === 'number') ? force.x : 0;
    const fy = (typeof force.y === 'number') ? force.y : 0;
    if (isNaN(fx) || isNaN(fy)) return;

    if (this.acc) {
      if (typeof createVector === 'function') {
        this.acc.add(createVector(fx, fy));
      } else if (typeof this.acc.add === 'function') {
        this.acc.add(fx, fy);
      } else {
        this.acc.x = (this.acc.x || 0) + fx;
        this.acc.y = (this.acc.y || 0) + fy;
      }
    }
  }

  applyBehaviors(walls, otherCars = []) {
    if (this.dead || this.finished) return;
    const steerForce = this.look(walls);
    this.applyForce(steerForce);

    // Séparation inter-voitures (7-Boids)
    if (otherCars && otherCars.length > 0) {
      const sepForce = this.separate(otherCars);
      if (sepForce) this.applyForce(sepForce);
      this.checkDrafting(otherCars);
    }
  }

  separate(otherVehicles, desiredSeparation = 24) {
    if (!otherVehicles || otherVehicles.length === 0) return null;

    let steerX = 0, steerY = 0;
    let count = 0;

    for (let other of otherVehicles) {
      if (!other || other === this || other.dead) continue;

      const dx = this.pos.x - other.pos.x;
      const dy = this.pos.y - other.pos.y;
      if (Math.abs(dx) > desiredSeparation || Math.abs(dy) > desiredSeparation) continue;

      const d = Math.hypot(dx, dy);
      if (d > 0 && d < desiredSeparation) {
        steerX += (dx / d) / d;
        steerY += (dy / d) / d;
        count++;
      }
    }

    if (count > 0) {
      steerX /= count;
      steerY /= count;
      const mag = Math.hypot(steerX, steerY);
      if (mag > 0) {
        const desX = (steerX / mag) * this.maxspeed;
        const desY = (steerY / mag) * this.maxspeed;
        let fx = desX - (this.vel.x || 0);
        let fy = desY - (this.vel.y || 0);
        const forceMag = Math.hypot(fx, fy);
        const limitForce = this.maxforce * 1.15;
        if (forceMag > limitForce) {
          fx = (fx / forceMag) * limitForce;
          fy = (fy / forceMag) * limitForce;
        }

        if (typeof p5 !== 'undefined' && p5.Vector && typeof createVector === 'function') {
          return createVector(fx, fy);
        }
        return { x: fx, y: fy };
      }
    }
    return null;
  }

  checkDrafting(otherVehicles) {
    this.isDrafting = false;
    this.draftBoost = 1.0;
    this.draftTarget = null;
    if (!otherVehicles || otherVehicles.length === 0) return;

    let myHeading = 0;
    if (this.vel && typeof this.vel.heading === 'function') {
      myHeading = this.vel.heading();
    } else if (this.vel) {
      myHeading = Math.atan2(this.vel.y || 0, this.vel.x || 0);
    }

    for (let other of otherVehicles) {
      if (!other || other === this || other.dead) continue;

      const dx = other.pos.x - this.pos.x;
      const dy = other.pos.y - this.pos.y;
      const d = Math.hypot(dx, dy);

      if (d > 16 && d < 80) {
        const angleToOther = Math.atan2(dy, dx);
        let diffAngle = Math.abs(angleToOther - myHeading);
        while (diffAngle > Math.PI) diffAngle = Math.abs(diffAngle - Math.PI * 2);

        if (diffAngle < 0.45) {
          this.isDrafting = true;
          this.draftBoost = 1.20; // +20% boost de vitesse max
          this.draftTarget = other;

          const pull = this.maxforce * 0.25;
          const fx = Math.cos(myHeading) * pull;
          const fy = Math.sin(myHeading) * pull;
          if (typeof p5 !== 'undefined' && p5.Vector && typeof createVector === 'function') {
            this.applyForce(createVector(fx, fy));
          } else {
            this.applyForce({ x: fx, y: fy });
          }
          break;
        }
      }
    }
  }

  spinOut() {
    this.isSpinning = true;
    this.spinTimer = 25;
    if (this.vel) {
      if (typeof this.vel.mult === 'function') {
        this.vel.mult(0.65);
      } else {
        this.vel.x *= 0.65;
        this.vel.y *= 0.65;
      }
    }
  }

  handleRaceCollision(walls) {
    this.isSpinning = true;
    this.spinTimer = 20;
    if (this.vel) {
      if (typeof this.vel.mult === 'function') {
        this.vel.mult(0.55);
      } else {
        this.vel.x *= 0.55;
        this.vel.y *= 0.55;
      }
    }
    // Répulsion douce vers le centre de la piste au checkpoint actuel
    if (typeof checkpoints !== 'undefined' && checkpoints.length > 0) {
      const curCp = checkpoints[this.index] || checkpoints[0];
      const mid = curCp.midpoint ? curCp.midpoint() : (curCp.a ? { x: (curCp.a.x + curCp.b.x) * 0.5, y: (curCp.a.y + curCp.b.y) * 0.5 } : { x: 0, y: 0 });
      const dx = mid.x - this.pos.x;
      const dy = mid.y - this.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      this.pos.x += (dx / d) * 3.5;
      this.pos.y += (dy / d) * 3.5;
    }
  }

  look(walls) {
    const inputs = [];
    this.lastSensorReadings = [];
    let minWallDist = this.sight;

    // Raycasting sur chaque capteur
    for (let i = 0; i < this.rays.length; i++) {
      const ray = this.rays[i];
      let closestPt = null;
      let record = this.sight;

      if (walls && walls.length > 0) {
        for (let wall of walls) {
          const pt = ray.cast(wall);
          if (pt) {
            let d;
            if (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.dist) {
              d = p5.Vector.dist(this.pos, pt);
            } else {
              d = Math.hypot(this.pos.x - pt.x, this.pos.y - pt.y);
            }

            if (d < record && d < this.sight) {
              record = d;
              closestPt = pt;
            }
          }
        }
      }

      if (record < minWallDist) minWallDist = record;

      // Collision fatale avec le mur (moins de 6 pixels)
      if (record < 6) {
        if (this.isRaceMode) {
          this.handleRaceCollision(walls);
        } else {
          this.dead = true;
        }
      }

      // Normalisation de l'entrée : 1 = obstacle imminent, 0 = voie libre
      const normDist = Math.max(0, Math.min(1, 1 - (record / this.sight)));
      inputs.push(normDist);
      this.lastSensorReadings.push({ dist: record, pt: closestPt, norm: normDist });
    }

    // Ajout optionnel du capteur de vitesse actuelle
    if (this.includeSpeedSensor) {
      const currentSpeed = (this.vel && typeof this.vel.mag === 'function')
        ? this.vel.mag()
        : Math.hypot(this.vel.x || 0, this.vel.y || 0);
      inputs.push(Math.min(1, currentSpeed / (this.maxspeed || 1)));
    }

    // Décision du réseau de neurones
    let rawSteer = 0.5;
    let rawSpeed = 0.8;
    if (this.brain && typeof this.brain.predict === 'function') {
      try {
        const output = this.brain.predict(inputs);
        rawSteer = (output && output[0] !== undefined) ? output[0] : 0.5;
        rawSpeed = (output && output[1] !== undefined) ? output[1] : 0.8;
      } catch (e) {
        rawSteer = 0.5;
        rawSpeed = 0.8;
      }
    }

    let steerAngle = (rawSteer * 2 - 1) * Math.PI; // Mappe [0, 1] vers [-PI, +PI]
    let currentHeading = 0;
    if (this.vel && typeof this.vel.heading === 'function') {
      currentHeading = this.vel.heading();
    } else if (this.vel) {
      currentHeading = Math.atan2(this.vel.y || 0, this.vel.x || 0);
    }
    let desiredHeading = currentHeading + steerAngle;
    let desiredSpeed = rawSpeed * this.maxspeed;

    // Si un profil de pilote IA est configuré (Mode Course Joueur vs IA)
    if (this.driverProfile && typeof checkpoints !== 'undefined' && checkpoints.length > 0) {
      const lookAhead = (this.driverProfile.lookAhead !== undefined) ? this.driverProfile.lookAhead : 1;
      const targetIdx = (this.index + lookAhead) % checkpoints.length;
      const targetCp = checkpoints[targetIdx];
      const targetMid = (targetCp && targetCp.midpoint) ? targetCp.midpoint() : (targetCp && targetCp.a ? { x: (targetCp.a.x + targetCp.b.x) * 0.5, y: (targetCp.a.y + targetCp.b.y) * 0.5 } : this.pos);

      const dx = targetMid.x - this.pos.x;
      const dy = targetMid.y - this.pos.y;
      const targetAngle = Math.atan2(dy, dx);

      // Répulsion des capteurs sur les murs (évitement d'obstacle Reynolds)
      let wallAvoidBias = 0;
      for (let i = 0; i < this.rays.length; i++) {
        const reading = this.lastSensorReadings[i];
        if (!reading || reading.dist >= this.sight * 0.70) continue;
        const urgency = Math.pow(Math.max(0, 1 - (reading.dist / (this.sight * 0.70))), 2);
        const rayAngle = this.rays[i].angle;
        const dirSign = rayAngle < -0.05 ? 1 : (rayAngle > 0.05 ? -1 : 0);
        wallAvoidBias += dirSign * urgency * 1.35;
      }

      // Wobble / hésitation naturelle selon le niveau (plus prononcé pour le Débutant)
      let wobble = 0;
      if (this.driverProfile.wobble > 0) {
        const t = (this.counter || 0) * 0.05 + (this.driverProfile.number || 1);
        wobble = Math.sin(t) * this.driverProfile.wobble;
      }

      let diffAngle = (targetAngle + wallAvoidBias + wobble) - currentHeading;
      while (diffAngle > Math.PI) diffAngle -= Math.PI * 2;
      while (diffAngle < -Math.PI) diffAngle += Math.PI * 2;

      const steerRate = this.driverProfile.steerRate || 0.075;
      const appliedSteer = Math.max(-steerRate, Math.min(steerRate, diffAngle));
      desiredHeading = currentHeading + appliedSteer;

      // Modulation de la vitesse selon la courbure et la prudence
      let spd = this.maxspeed;
      const turnSharpness = Math.abs(diffAngle);
      const caution = this.driverProfile.caution || 0.85;
      if (turnSharpness > 0.22) {
        spd *= Math.max(0.42, 1.0 - (turnSharpness / Math.PI) * caution);
      }
      if (minWallDist < 35) {
        spd *= Math.max(0.38, minWallDist / 35);
      }
      desiredSpeed = spd;
    }

    // Modèle de steering Reynolds : force = desiredVelocity - currentVelocity
    if (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.fromAngle) {
      const desiredVel = p5.Vector.fromAngle(desiredHeading).setMag(desiredSpeed);
      const force = p5.Vector.sub(desiredVel, this.vel);
      force.limit(this.maxforce);
      return force;
    } else {
      const desX = Math.cos(desiredHeading) * desiredSpeed;
      const desY = Math.sin(desiredHeading) * desiredSpeed;
      let fx = desX - (this.vel.x || 0);
      let fy = desY - (this.vel.y || 0);
      const mag = Math.hypot(fx, fy);
      if (mag > this.maxforce && mag > 0) {
        fx = (fx / mag) * this.maxforce;
        fy = (fy / mag) * this.maxforce;
      }
      return { x: fx, y: fy };
    }
  }

  update() {
    if (this.dead || this.finished) return;

    if (this.isSpinning) {
      this.spinTimer--;
      if (this.spinTimer <= 0) {
        this.isSpinning = false;
      }
    }

    const effectiveMaxSpeed = this.maxspeed * (this.draftBoost || 1.0);

    // Locomotion
    if (typeof this.pos.add === 'function') {
      this.pos.add(this.vel);
      this.vel.add(this.acc);
      this.vel.limit(effectiveMaxSpeed);
      this.acc.set(0, 0);
    } else {
      this.vel.x = (this.vel.x || 0) + (this.acc.x || 0);
      this.vel.y = (this.vel.y || 0) + (this.acc.y || 0);
      const spd = Math.hypot(this.vel.x, this.vel.y);
      if (spd > effectiveMaxSpeed && spd > 0) {
        this.vel.x = (this.vel.x / spd) * effectiveMaxSpeed;
        this.vel.y = (this.vel.y / spd) * effectiveMaxSpeed;
      }
      this.pos.x += this.vel.x;
      this.pos.y += this.vel.y;
      this.acc.x = 0;
      this.acc.y = 0;
    }

    // Gestion de la durée de vie sans franchir de checkpoint (uniquement en mode Évolution)
    if (!this.isRaceMode) {
      this.counter++;
      if (this.counter > this.lifespan) {
        this.dead = true;
      }
    } else {
      this.counter++;
    }

    // Orientation dynamique des capteurs selon le cap de la voiture
    let heading = 0;
    if (this.vel && typeof this.vel.heading === 'function') {
      heading = this.vel.heading();
    } else if (this.vel) {
      heading = Math.atan2(this.vel.y || 0, this.vel.x || 0);
    }

    for (let i = 0; i < this.rays.length; i++) {
      this.rays[i].rotate(heading);
    }
  }

  check(checkpoints) {
    if (this.dead || this.finished || !checkpoints || checkpoints.length === 0) return;

    this.goal = checkpoints[this.index];
    if (!this.goal) return;

    // Distance point-droite par rapport au checkpoint cible
    let distToCheckpoint = Infinity;
    if (typeof pldistance === 'function' && this.goal.a && this.goal.b) {
      distToCheckpoint = pldistance(this.goal.a, this.goal.b, this.pos.x, this.pos.y);
    } else if (this.goal.midpoint) {
      const mid = this.goal.midpoint();
      distToCheckpoint = Math.hypot(this.pos.x - mid.x, this.pos.y - mid.y);
    }

    // Franchissement validé si proche du checkpoint
    if (distToCheckpoint < 16) {
      this.index = (this.index + 1) % checkpoints.length;
      this.fitness++;
      this.counter = 0; // Réinitialise le compte à rebours d'inactivité

      // Boucle de circuit complète
      if (this.index === 0 && this.fitness >= checkpoints.length * 0.8) {
        this.laps++;
      }
    }
  }

  calculateFitness() {
    // Calcul continu de fitness : checkpoints franchis + progression vers le checkpoint suivant
    let progressBonus = 0;
    if (this.goal && this.goal.midpoint) {
      const mid = this.goal.midpoint();
      const d = (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.dist)
        ? p5.Vector.dist(this.pos, mid)
        : Math.hypot(this.pos.x - mid.x, this.pos.y - mid.y);
      progressBonus = Math.max(0, Math.min(1, 1 - (d / 180)));
    }

    const totalCheckpointsScore = this.fitness + progressBonus + (this.laps * 25);
    // Puissance 2 pour favoriser exponentiellement les meilleurs pilotes
    this.fitnessScore = Math.pow(Math.max(0.1, totalCheckpointsScore), 2);
    this.fitness = this.fitnessScore;
  }

  mutate(rate = 0.1) {
    if (this.brain) {
      this.brain.mutate(rate);
    }
  }

  dispose() {
    if (this.brain && typeof this.brain.dispose === 'function') {
      this.brain.dispose();
    }
  }

  show(isLeader = false, isDebug = false) {
    if (typeof push !== 'function') return;
    if (this.dead && !isLeader && !isDebug && !this.driverProfile) return;

    push();
    translate(this.pos.x, this.pos.y);
    const heading = (this.vel && typeof this.vel.heading === 'function') ? this.vel.heading() : 0;
    rotate(heading);

    if (this.driverProfile) {
      const rgb = this.driverProfile.rgb || [56, 189, 248];

      // Carrosserie sportive personnalisée du pilote
      fill(rgb[0], rgb[1], rgb[2], this.isSpinning ? 150 : 235);
      stroke(255, 255, 255, 200);
      strokeWeight(1.2);
      rectMode(CENTER);
      rect(0, 0, 20, 10, 2);

      // Aileron arrière
      fill(rgb[0] * 0.7, rgb[1] * 0.7, rgb[2] * 0.7);
      rect(-10, 0, 3, 12, 1);

      // Cockpit teinté
      fill(15, 23, 42);
      noStroke();
      rect(2, 0, 5, 7, 1);

      // Phares avant blancs
      fill(255, 255, 255);
      ellipse(9, -3.5, 2.5, 2.5);
      ellipse(9, 3.5, 2.5, 2.5);

      // Feux arrière rouges
      fill(239, 68, 68);
      ellipse(-9, -3.5, 2, 2);
      ellipse(-9, 3.5, 2, 2);

      // Numéro sur le toit
      if (typeof text === 'function') {
        fill(255);
        noStroke();
        textSize(6);
        textAlign(CENTER, CENTER);
        text(this.driverProfile.number || '', 0, 0);
      }
    } else if (isLeader) {
      // Aura dorée pour le leader
      noFill();
      stroke(255, 215, 0, 180);
      strokeWeight(2.5);
      ellipse(0, 0, 32, 22);

      // Carrosserie sportive dorée
      fill(255, 215, 0);
      stroke(255, 255, 255);
      strokeWeight(1.5);
      rectMode(CENTER);
      rect(0, 0, 22, 11, 3);

      // Pare-brise cockpit
      fill(15, 23, 42);
      noStroke();
      rect(3, 0, 6, 8, 1);

      // Phares néon avant
      fill(255, 255, 255);
      ellipse(10, -4, 3, 3);
      ellipse(10, 4, 3, 3);
    } else {
      // Voitures normales : carrosserie cyan/bleu semi-transparente
      fill(56, 189, 248, 130);
      stroke(14, 165, 233, 180);
      strokeWeight(1);
      rectMode(CENTER);
      rect(0, 0, 16, 8, 2);

      // Cockpit
      fill(15, 23, 42, 190);
      noStroke();
      rect(2, 0, 4, 6, 1);
    }

    // OVERLAY DEBUG (Vélocité, Hitbox et Vitesse)
    if (isDebug && !this.dead) {
      // Vecteur vitesse (flèche cyan)
      stroke(0, 210, 255);
      strokeWeight(2);
      line(0, 0, 18, 0);
      fill(0, 210, 255);
      triangle(18, -3, 23, 0, 18, 3);

      // Cercle de collision mortelle (zone de danger 6px)
      noFill();
      stroke(239, 68, 68, 180);
      strokeWeight(1.2);
      ellipse(0, 0, 12, 12);
    }
    pop();

    // Badge flottant du pilote en mode Course
    if (this.driverProfile && typeof text === 'function' && typeof push === 'function') {
      push();
      translate(this.pos.x, this.pos.y - 14);
      noStroke();
      fill(13, 20, 36, 190);
      rectMode(CENTER);
      const label = `${this.driverProfile.name} #${this.driverProfile.number}`;
      rect(0, 0, textWidth(label) + 8, 12, 3);
      fill(this.driverProfile.color || '#38bdf8');
      textSize(8);
      textStyle(BOLD);
      textAlign(CENTER, CENTER);
      text(label, 0, 0);
      pop();
    }

    // En mode debug, afficher les faisceaux de vision des voitures actives
    if (isDebug && !this.dead && !isLeader) {
      push();
      for (let reading of this.lastSensorReadings) {
        if (reading.pt) {
          stroke(56, 189, 248, 40);
          strokeWeight(1);
          line(this.pos.x, this.pos.y, reading.pt.x, reading.pt.y);
        }
      }
      pop();
    }
  }

  highlight(isDebug = false) {
    this.show(true, isDebug);

    if (typeof push !== 'function') return;
    // Dessine les faisceaux de détection du leader avec points d'impact
    push();
    for (let reading of this.lastSensorReadings) {
      if (reading.pt) {
        // Ligne de rayon
        stroke(16, 185, 129, 160);
        strokeWeight(1.8);
        line(this.pos.x, this.pos.y, reading.pt.x, reading.pt.y);

        // Point d'impact sur le mur
        fill(239, 68, 68);
        noStroke();
        circle(reading.pt.x, reading.pt.y, 6);
      }
    }

    // Checkpoint cible mis en valeur
    if (this.goal && typeof line === 'function') {
      stroke(245, 158, 11);
      strokeWeight(3.5);
      line(this.goal.a.x, this.goal.a.y, this.goal.b.x, this.goal.b.y);
    }

    // Label debug au-dessus du leader
    if (isDebug) {
      fill(255, 215, 0);
      noStroke();
      textSize(10);
      textAlign(CENTER);
      const spd = this.vel && typeof this.vel.mag === 'function' ? this.vel.mag().toFixed(1) : '0';
      text(`Leader | Fit: ${Math.round(this.fitness)} | Vit: ${spd}`, this.pos.x, this.pos.y - 18);
    }
    pop();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CarVehicle };
} else {
  globalThis.CarVehicle = CarVehicle;
  if (typeof window !== 'undefined') window.CarVehicle = CarVehicle;
}
