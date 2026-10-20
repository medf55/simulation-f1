/**
 * PlayerCar - Véhicule pilotable par le joueur humain.
 * Étend Vehicle conformément aux consignes d'architecture Reynolds.
 * Intègre locomotion par forces (accélération, freinage, braquage, traînée naturelle),
 * détection des checkpoints, chronométrage F1 des tours, gestion des collisions par segments,
 * et protection anti-boucle de crash après réapparition.
 */

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

var BaseVehicle = globalThis.BaseVehicle || ((typeof Vehicle !== 'undefined') ? Vehicle : class {
  constructor() {
    this.pos = (typeof createVector === 'function') ? createVector(0, 0) : { x: 0, y: 0 };
    this.vel = (typeof createVector === 'function') ? createVector(0, 0) : { x: 0, y: 0 };
    this.acc = (typeof createVector === 'function') ? createVector(0, 0) : { x: 0, y: 0 };
  }
  applyForce(force) {
    if (this.acc && typeof this.acc.add === 'function') {
      this.acc.add(force);
    } else {
      this.acc.x = (this.acc.x || 0) + (force.x || 0);
      this.acc.y = (this.acc.y || 0) + (force.y || 0);
    }
  }
});
globalThis.BaseVehicle = BaseVehicle;

const PLAYER_LIVERIES = [
  { name: 'Cyan Néon', color: '#00d2ff', rgb: [0, 210, 255] },
  { name: 'Rouge Écarlate', color: '#ef4444', rgb: [239, 68, 68] },
  { name: 'Vert Fluo', color: '#10b981', rgb: [16, 185, 129] },
  { name: 'Doré Champion', color: '#f59e0b', rgb: [245, 158, 11] },
  { name: 'Violet Cyberpunk', color: '#a855f7', rgb: [168, 85, 247] },
  { name: 'Noir Carbone', color: '#64748b', rgb: [100, 116, 139] }
];

class PlayerCar extends BaseVehicle {
  constructor(x, y, config = {}) {
    super();

    // Libération immédiate de tout réseau de neurones hérité pour le joueur humain
    if (this.brain && typeof this.brain.dispose === 'function') {
      try { this.brain.dispose(); } catch (e) {}
    }
    this.brain = null;

    const startX = x !== undefined ? x : (typeof start !== 'undefined' && start ? start.x : 0);
    const startY = y !== undefined ? y : (typeof start !== 'undefined' && start ? start.y : 0);

    if (typeof createVector === 'function') {
      this.pos = createVector(startX, startY);
      this.vel = createVector(0, 0);
      this.acc = createVector(0, 0);
    } else {
      this.pos = { x: startX, y: startY };
      this.vel = { x: 0, y: 0 };
      this.acc = { x: 0, y: 0 };
    }

    this.headingAngle = config.headingAngle || 0;
    this.maxspeed = config.maxspeed || 5.2;
    this.maxforce = config.maxforce || 0.28;
    this.steerSensitivity = config.steerSensitivity || 0.068;
    this.dragCoeff = 0.965; // Frein moteur naturel lors du relâchement de l'accélérateur
    this.throttle = 0; // Pédale d'accélérateur progressive (0 à 1)
    this.lateralGrip = 0.80; // Adhérence latérale des pneus pour virages précis sans glisse

    // Livrée personnalisée du joueur
    this.liveryIndex = config.liveryIndex || 0;
    this.livery = PLAYER_LIVERIES[this.liveryIndex] || PLAYER_LIVERIES[0];

    // État du jeu & chronométrage
    this.index = 0;
    this.laps = 0;
    this.fitness = 0;
    this.dead = false;
    this.crashed = false;
    this.crashTimer = 0;
    this.invulnerableTimer = 0; // Période de grâce après respawn
    this.respawnPoint = { x: startX, y: startY };

    // Aspiration / Slipstream
    this.isDrafting = false;
    this.draftTimer = 0;
    this.draftBoost = 1.0;
    this.draftTarget = null;

    // Effet flaque d'huile / dérapage
    this.isSpinning = false;
    this.spinTimer = 0;

    // Traces de pneus doubles & fumée de dérive
    this.skidHistory = [];
    this.maxSkidPoints = 55;
    this.smokeParticles = [];

    // Télémétrie F1
    this.lapStartTime = 0;
    this.currentLapTime = 0;
    this.bestLapTime = Infinity;
    this.lastLapTime = 0;
    this.lapStarted = false;
  }

  cycleLivery() {
    this.liveryIndex = (this.liveryIndex + 1) % PLAYER_LIVERIES.length;
    this.livery = PLAYER_LIVERIES[this.liveryIndex];
    return this.livery;
  }

  get skidMarks() {
    return this.skidHistory;
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

  handleInput(keys) {
    if (this.dead || this.crashed || !keys) return;

    if (this.isSpinning) {
      this.headingAngle += 0.22;
      this.spinTimer--;
      if (this.spinTimer <= 0) {
        this.isSpinning = false;
      }
      return;
    }

    const currentSpeed = (this.vel && typeof this.vel.mag === 'function')
      ? this.vel.mag()
      : Math.hypot(this.vel.x || 0, this.vel.y || 0);

    // Braquage réactif et naturel : maniable à basse vitesse, stable à haute vitesse
    const turnFactor = Math.min(1.2, Math.max(0.72, 1.05 - (currentSpeed / (this.maxspeed * 1.8))));
    const effectiveSteer = this.steerSensitivity * 1.15 * turnFactor;
    if (keys.left) {
      this.headingAngle -= effectiveSteer;
    }
    if (keys.right) {
      this.headingAngle += effectiveSteer;
    }

    const effectiveMaxSpeed = this.maxspeed * this.draftBoost;

    // Accélération avant (Gaz) - Progressive avec montée en régime fluide (anti-à-coups)
    if (keys.up) {
      this.throttle = Math.min(1.0, this.throttle + 0.12);
      // Vitesse visée progressive pour un départ dosé et naturel
      const targetSpeed = effectiveMaxSpeed * Math.max(0.35, this.throttle);

      let desiredVel;
      if (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.fromAngle) {
        desiredVel = p5.Vector.fromAngle(this.headingAngle).setMag(targetSpeed);
        const steer = p5.Vector.sub(desiredVel, this.vel);
        steer.limit(this.maxforce);
        this.applyForce(steer);
      } else {
        const desX = Math.cos(this.headingAngle) * targetSpeed;
        const desY = Math.sin(this.headingAngle) * targetSpeed;
        let fx = desX - (this.vel.x || 0);
        let fy = desY - (this.vel.y || 0);
        const m = Math.hypot(fx, fy);
        if (m > this.maxforce && m > 0) {
          fx = (fx / m) * this.maxforce;
          fy = (fy / m) * this.maxforce;
        }
        this.applyForce({ x: fx, y: fy });
      }
    } else {
      // Relâchement naturel de l'accélérateur
      this.throttle = Math.max(0, this.throttle - 0.15);
    }

    // Freinage actif / Marche arrière
    if (keys.down) {
      if (currentSpeed > 0.3) {
        // Freinage puissant opposé à la vitesse courante
        if (typeof p5 !== 'undefined' && p5.Vector && this.vel.copy) {
          const brakeForce = this.vel.copy().normalize().mult(-this.maxforce * 1.5);
          this.applyForce(brakeForce);
        } else {
          const invMag = 1 / currentSpeed;
          this.applyForce({
            x: -(this.vel.x || 0) * invMag * this.maxforce * 1.5,
            y: -(this.vel.y || 0) * invMag * this.maxforce * 1.5
          });
        }
        this.recordSkidMark();
      } else {
        // Recul doux pour manœuvrer
        const revSpeed = effectiveMaxSpeed * 0.35;
        const desX = -Math.cos(this.headingAngle) * revSpeed;
        const desY = -Math.sin(this.headingAngle) * revSpeed;
        this.applyForce({ x: (desX - (this.vel.x || 0)) * 0.3, y: (desY - (this.vel.y || 0)) * 0.3 });
      }
    }

    // Dérapage contrôlé si braquage vif, frein à main ou déstabilisation
    if (((keys.left || keys.right) && currentSpeed > effectiveMaxSpeed * 0.55) || keys.space || this.isSpinning) {
      this.recordSkidMark();
    }
  }

  recordSkidMark() {
    const perpAngle = this.headingAngle + Math.PI / 2;
    const offset = 6.0;
    const lx = this.pos.x + Math.cos(perpAngle) * offset - Math.cos(this.headingAngle) * 8;
    const ly = this.pos.y + Math.sin(perpAngle) * offset - Math.sin(this.headingAngle) * 8;
    const rx = this.pos.x - Math.cos(perpAngle) * offset - Math.cos(this.headingAngle) * 8;
    const ry = this.pos.y - Math.sin(perpAngle) * offset - Math.sin(this.headingAngle) * 8;

    const leftPt = (typeof createVector === 'function') ? createVector(lx, ly) : { x: lx, y: ly };
    const rightPt = (typeof createVector === 'function') ? createVector(rx, ry) : { x: rx, y: ry };

    this.skidHistory.push({
      l: leftPt,
      r: rightPt,
      left: leftPt,
      right: rightPt,
      pos: leftPt, // compatibilité tests existants
      angle: this.headingAngle,
      life: 1.0
    });
    if (this.skidHistory.length > this.maxSkidPoints) {
      this.skidHistory.shift();
    }

    // Particules de fumée de pneu en dérive
    if (this.smokeParticles.length < 40 && (this.smokeParticles.length === 0 || Math.random() < 0.75)) {
      this.smokeParticles.push({
        x: (lx + rx) * 0.5 + (Math.random() - 0.5) * 4,
        y: (ly + ry) * 0.5 + (Math.random() - 0.5) * 4,
        vx: -Math.cos(this.headingAngle) * 0.7 + (Math.random() - 0.5) * 0.5,
        vy: -Math.sin(this.headingAngle) * 0.7 + (Math.random() - 0.5) * 0.5,
        size: 3 + Math.random() * 4,
        life: 1.0
      });
    }
  }

  separate(otherVehicles, desiredSeparation = 26) {
    if (!otherVehicles || otherVehicles.length === 0) return;

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
        steerX = (steerX / mag) * this.maxspeed - (this.vel.x || 0);
        steerY = (steerY / mag) * this.maxspeed - (this.vel.y || 0);
        const forceMag = Math.hypot(steerX, steerY);
        const limitForce = this.maxforce * 1.25;
        if (forceMag > limitForce) {
          steerX = (steerX / forceMag) * limitForce;
          steerY = (steerY / forceMag) * limitForce;
        }
        this.applyForce({ x: steerX, y: steerY });
      }
    }
  }

  checkDrafting(otherVehicles) {
    this.isDrafting = false;
    this.draftBoost = 1.0;
    this.draftTarget = null;
    if (!otherVehicles || otherVehicles.length === 0) return;

    const myHeading = this.headingAngle;
    let closestLeader = null;
    let minD = 95;

    for (let other of otherVehicles) {
      if (!other || other === this || other.dead) continue;

      const dx = other.pos.x - this.pos.x;
      const dy = other.pos.y - this.pos.y;
      const d = Math.hypot(dx, dy);

      // Distance propice à l'aspiration : entre 18 et 95 pixels
      if (d > 18 && d < minD) {
        const angleToOther = Math.atan2(dy, dx);
        let diffAngle = Math.abs(angleToOther - myHeading);
        while (diffAngle > Math.PI) diffAngle = Math.abs(diffAngle - Math.PI * 2);

        // Dans un cône de vision frontal de ±28°
        if (diffAngle < 0.48) {
          minD = d;
          closestLeader = other;
        }
      }
    }

    if (closestLeader) {
      this.isDrafting = true;
      this.draftBoost = 1.22; // +22% de vitesse de pointe dans l'aspiration
      this.draftTarget = closestLeader;

      const pullForce = this.maxforce * 0.35;
      const fx = Math.cos(this.headingAngle) * pullForce;
      const fy = Math.sin(this.headingAngle) * pullForce;
      this.applyForce({ x: fx, y: fy });
    }
  }

  update() {
    if (this.dead) return;

    if (this.crashed) {
      this.crashTimer--;
      if (this.crashTimer <= 0) {
        this.respawn();
      }
      return;
    }

    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer--;
    }

    // Intégration de l'accélération
    if (typeof this.vel.add === 'function') {
      this.vel.add(this.acc);
    } else {
      this.vel.x = (this.vel.x || 0) + (this.acc.x || 0);
      this.vel.y = (this.vel.y || 0) + (this.acc.y || 0);
    }
    if (typeof this.acc.set === 'function') {
      this.acc.set(0, 0);
    } else {
      this.acc.x = 0;
      this.acc.y = 0;
    }

    // ADHÉRENCE LATÉRALE DES PNEUS (Élimine le glissement latéral type patinoire)
    const forwardX = Math.cos(this.headingAngle);
    const forwardY = Math.sin(this.headingAngle);
    const rightX = -forwardY;
    const rightY = forwardX;

    const forwardSpeed = (this.vel.x * forwardX + this.vel.y * forwardY);
    const lateralSpeed = (this.vel.x * rightX + this.vel.y * rightY);

    // Amortissement de la composante latérale selon le grip des pneus
    const adjustedLateral = lateralSpeed * this.lateralGrip;

    this.vel.x = forwardX * forwardSpeed + rightX * adjustedLateral;
    this.vel.y = forwardY * forwardSpeed + rightY * adjustedLateral;

    // Frein moteur naturel quand le joueur n'accélère pas
    const currentDrag = (this.throttle > 0.05) ? 0.992 : this.dragCoeff;
    this.vel.x *= currentDrag;
    this.vel.y *= currentDrag;

    // Limitation de vitesse maximale
    const spd = Math.hypot(this.vel.x, this.vel.y);
    const curMax = this.maxspeed * this.draftBoost;
    if (spd > curMax && spd > 0) {
      this.vel.x = (this.vel.x / spd) * curMax;
      this.vel.y = (this.vel.y / spd) * curMax;
    }

    // Déplacement
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;

    // Protection anti-NaN
    if (isNaN(this.pos.x) || isNaN(this.pos.y) || isNaN(this.vel.x) || isNaN(this.vel.y)) {
      this.respawn();
    }

    // Chronométrage du tour
    if (this.lapStarted && typeof millis === 'function') {
      this.currentLapTime = (millis() - this.lapStartTime) / 1000;
    }

    // Détection de dérive/glissade latérale à vitesse élevée
    const currentSpeed = Math.hypot(this.vel.x || 0, this.vel.y || 0);
    const velHeading = Math.atan2(this.vel.y || 0, this.vel.x || 0);
    let driftAngle = Math.abs(this.headingAngle - velHeading);
    while (driftAngle > Math.PI) driftAngle = Math.abs(driftAngle - Math.PI * 2);
    if (currentSpeed > 2.8 && driftAngle > 0.32) {
      this.recordSkidMark();
    }

    // Décroissance des traces de pneus
    for (let i = this.skidHistory.length - 1; i >= 0; i--) {
      this.skidHistory[i].life -= 0.022;
      if (this.skidHistory[i].life <= 0) {
        this.skidHistory.splice(i, 1);
      }
    }

    // Décroissance et physique des particules de fumée
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.045;
      if (p.life <= 0) {
        this.smokeParticles.splice(i, 1);
      }
    }
  }

  check(checkpoints) {
    if (this.dead || this.crashed || !checkpoints || checkpoints.length === 0) return;

    const goal = checkpoints[this.index];
    if (!goal || !goal.a || !goal.b) return;

    const dist = distToSegment(this.pos.x, this.pos.y, goal.a.x, goal.a.y, goal.b.x, goal.b.y);

    if (dist < 34) {
      this.respawnPoint = goal.midpoint ? goal.midpoint() : { x: (goal.a.x + goal.b.x) * 0.5, y: (goal.a.y + goal.b.y) * 0.5 };

      // Premier franchissement du départ
      if (!this.lapStarted && this.index === 0 && typeof millis === 'function') {
        this.lapStarted = true;
        this.lapStartTime = millis();
      }

      this.index = (this.index + 1) % checkpoints.length;
      this.fitness++;

      // Tour complet validé
      if (this.index === 0 && this.fitness >= checkpoints.length * 0.75) {
        this.laps++;
        if (typeof millis === 'function') {
          const lapDuration = (millis() - this.lapStartTime) / 1000;
          this.lastLapTime = lapDuration;
          if (lapDuration < this.bestLapTime) {
            this.bestLapTime = lapDuration;
          }
          this.lapStartTime = millis();
        }
      }
    }
  }

  checkWalls(walls) {
    if (this.dead || this.crashed || this.invulnerableTimer > 0 || !walls || walls.length === 0) return;

    for (let wall of walls) {
      if (!wall || !wall.a || !wall.b) continue;
      const d = distToSegment(this.pos.x, this.pos.y, wall.a.x, wall.a.y, wall.b.x, wall.b.y);

      // Contact avec le rail : à moins de 8 pixels
      if (d < 8) {
        // En cas de mur au contact direct (< 5.5px) ou d'impact violent : crash
        // Sinon : amorti doux le long de la glissière pour une conduite fluide sans frustration
        const segDx = wall.b.x - wall.a.x;
        const segDy = wall.b.y - wall.a.y;
        const segLen = Math.hypot(segDx, segDy) || 1;

        // Normale du mur vers le véhicule
        let nx = -segDy / segLen;
        let ny = segDx / segLen;
        const toCarX = this.pos.x - wall.a.x;
        const toCarY = this.pos.y - wall.a.y;
        if (toCarX * nx + toCarY * ny < 0) {
          nx = -nx;
          ny = -ny;
        }

        const curSpd = Math.hypot(this.vel.x || 0, this.vel.y || 0);
        const normalVel = (this.vel.x * nx + this.vel.y * ny);

        if (d < 5.5 || (curSpd > 4.2 && normalVel < -1.8)) {
          this.triggerCrash();
          break;
        } else {
          // Rebond souple : repousse le bolide doucement sur la piste
          const push = 8 - d + 1.2;
          this.pos.x += nx * push;
          this.pos.y += ny * push;

          // Déflexion de la vitesse le long du rail avec friction naturelle
          if (normalVel < 0) {
            this.vel.x = (this.vel.x - normalVel * nx * 1.25) * 0.85;
            this.vel.y = (this.vel.y - normalVel * ny * 1.25) * 0.85;
          }
          this.recordSkidMark();
          break;
        }
      }
    }
  }

  triggerCrash() {
    this.crashed = true;
    this.crashTimer = 30; // 30 frames de récupération
    if (typeof this.vel.set === 'function') {
      this.vel.set(0, 0);
      this.acc.set(0, 0);
    } else {
      this.vel.x = 0;
      this.vel.y = 0;
      this.acc.x = 0;
      this.acc.y = 0;
    }
  }

  respawn() {
    this.crashed = false;
    this.crashTimer = 0;
    this.invulnerableTimer = 45; // 45 frames de grâce anti-recollision
    this.throttle = 0; // Pédale relâchée pour un redémarrage serein et dosé

    const rx = this.respawnPoint ? this.respawnPoint.x : (typeof start !== 'undefined' && start ? start.x : 0);
    const ry = this.respawnPoint ? this.respawnPoint.y : (typeof start !== 'undefined' && start ? start.y : 0);

    if (typeof this.pos.set === 'function') {
      this.pos.set(rx, ry);
    } else {
      this.pos.x = rx;
      this.pos.y = ry;
    }

    if (typeof this.vel.set === 'function') {
      this.vel.set(0, 0);
      this.acc.set(0, 0);
    } else {
      this.vel.x = 0;
      this.vel.y = 0;
      this.acc.x = 0;
      this.acc.y = 0;
    }

    if (typeof checkpoints !== 'undefined' && checkpoints && checkpoints.length > 0) {
      const targetCp = checkpoints[this.index] || checkpoints[1];
      if (targetCp) {
        const mid = targetCp.midpoint ? targetCp.midpoint() : { x: (targetCp.a.x + targetCp.b.x) * 0.5, y: (targetCp.a.y + targetCp.b.y) * 0.5 };
        this.headingAngle = Math.atan2(mid.y - this.pos.y, mid.x - this.pos.x);
      }
    }
  }

  spinOut() {
    if (!this.isSpinning) {
      this.isSpinning = true;
      this.spinTimer = 30;
      // Perte d'adhérence
      if (typeof this.vel.mult === 'function') {
        this.vel.mult(0.6);
      }
      this.recordSkidMark();
    }
  }

  show() {
    if (typeof push !== 'function') return;

    // 1. Traces de dérapage doubles au sol
    for (let skid of this.skidHistory) {
      push();
      stroke(15, 23, 42, skid.life * 190);
      strokeWeight(2.8);
      if (skid.l && skid.r) {
        point(skid.l.x, skid.l.y);
        point(skid.r.x, skid.r.y);
      } else if (skid.pos) {
        point(skid.pos.x, skid.pos.y);
      }
      pop();
    }

    // 1b. Fumée de pneus en dérive
    for (let p of this.smokeParticles) {
      push();
      noStroke();
      fill(240, 245, 255, p.life * 75);
      circle(p.x, p.y, p.size * (2.0 - p.life));
      pop();
    }

    // 2. Traînées d'aspiration aérodynamique (vent bleu néon)
    if (this.isDrafting && this.draftTarget) {
      push();
      stroke(56, 189, 248, 160 + sin(frameCount * 0.3) * 60);
      strokeWeight(2);
      line(this.pos.x, this.pos.y, this.draftTarget.pos.x, this.draftTarget.pos.y);
      pop();
    }

    push();
    translate(this.pos.x, this.pos.y);

    // 3. Indicateur joueur "VOUS" / chevron au-dessus du véhicule
    push();
    noStroke();
    fill(14, 165, 233, 240);
    textSize(10);
    textAlign(CENTER, BOTTOM);
    textStyle(BOLD);
    text("VOUS", 0, -18);
    fill(56, 189, 248, 240);
    triangle(-5, -15, 5, -15, 0, -10);
    pop();

    rotate(this.headingAngle);

    // Effet clignotement pendant la période de grâce post-respawn
    if (this.invulnerableTimer > 0 && (frameCount % 6 < 3)) {
      drawingContext.globalAlpha = 0.5;
    }

    // Phares avant (faisceaux lumineux sur la piste)
    push();
    noStroke();
    fill(255, 255, 200, 45);
    triangle(14, -6, 14, 6, 90, 0);
    pop();

    // Carrosserie sportive personnalisable du Joueur
    // Ombre portée
    noStroke();
    fill(0, 0, 0, 120);
    rectMode(CENTER);
    rect(1, 3, 26, 14, 4);

    // Carrosserie principale (flash rouge si crashé)
    const rgb = (this.livery && this.livery.rgb) ? this.livery.rgb : [14, 165, 233];
    if (this.crashed && (frameCount % 6 < 3)) {
      fill(239, 68, 68);
    } else {
      fill(rgb[0], rgb[1], rgb[2]); // Couleur de la livrée active
    }
    stroke(255, 255, 255);
    strokeWeight(1.8);
    rect(0, 0, 24, 12, 4);

    // Bandes de course blanches / dorées
    fill(245, 158, 11);
    noStroke();
    rect(0, 0, 24, 2);

    // Cockpit teinté
    fill(15, 23, 42);
    stroke(56, 189, 248);
    strokeWeight(1);
    rect(-1, 0, 10, 7, 2);

    // Aileron arrière sport
    fill(2, 132, 199);
    stroke(255, 255, 255);
    strokeWeight(1);
    rect(-11, 0, 4, 14, 1);

    // Numéro de course #1
    fill(255, 255, 255);
    noStroke();
    textSize(7);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    text("1", 4, 0);

    // Feux stop arrière rouges en cas de freinage
    if (typeof keysPressed !== 'undefined' && keysPressed.down) {
      fill(239, 68, 68, 255);
      noStroke();
      rect(-12, -4, 2, 3);
      rect(-12, 4, 2, 3);
      fill(239, 68, 68, 100);
      circle(-13, -4, 9);
      circle(-13, 4, 9);
    }

    // Flamme de propulsion à l'accélération
    const currentSpeed = (this.vel && typeof this.vel.mag === 'function')
      ? this.vel.mag()
      : Math.hypot(this.vel.x || 0, this.vel.y || 0);

    if (currentSpeed > 2.5) {
      fill(245, 158, 11, 200 + random(55));
      noStroke();
      triangle(-13, -3, -13, 3, -19 - random(6), 0);
      if (this.isDrafting) {
        fill(56, 189, 248, 220);
        triangle(-13, -2, -13, 2, -22 - random(8), 0);
      }
    }

    // Animation de crash superposée
    if (this.crashed) {
      push();
      fill(239, 68, 68, 160);
      noStroke();
      circle(0, 0, 20 + random(-2, 2));
      fill(255, 255, 255);
      textSize(12);
      textAlign(CENTER, CENTER);
      text("💥", 0, 0);
      pop();
    }

    pop();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerCar, distToSegment, PLAYER_LIVERIES };
} else {
  globalThis.PlayerCar = PlayerCar;
  globalThis.distToSegment = distToSegment;
  globalThis.PLAYER_LIVERIES = PLAYER_LIVERIES;
  if (typeof window !== 'undefined') {
    window.PlayerCar = PlayerCar;
    window.distToSegment = distToSegment;
    window.PLAYER_LIVERIES = PLAYER_LIVERIES;
  }
}
