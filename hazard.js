/**
 * Hazard - Entité d'obstacle ou flaque d'huile sur le circuit.
 * Étend Vehicle conformément aux consignes strictes d'architecture :
 * "Toute entité visible doit étendre Vehicle, y compris une entité qui paraît statique."
 */

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

class Hazard extends BaseVehicle {
  constructor(x, y, type = 'oil', radius = 22) {
    super();

    if (typeof createVector === 'function') {
      this.pos = createVector(x, y);
      this.vel = createVector(0, 0);
      this.acc = createVector(0, 0);
    } else {
      this.pos = { x, y };
      this.vel = { x: 0, y: 0 };
      this.acc = { x: 0, y: 0 };
    }

    this.type = type; // 'oil' (flaque d'huile) ou 'cone' (cône de chantier)
    this.r = radius;
    this.angle = (typeof random === 'function') ? random(Math.PI * 2) : 0;
  }

  // Interaction avec une voiture (IA ou joueur)
  checkCollision(vehicle) {
    if (!vehicle || vehicle.dead) return false;

    const d = (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.dist)
      ? p5.Vector.dist(this.pos, vehicle.pos)
      : Math.hypot(this.pos.x - vehicle.pos.x, this.pos.y - vehicle.pos.y);

    if (d < this.r + 8) {
      if (this.type === 'oil') {
        if (typeof vehicle.spinOut === 'function') {
          vehicle.spinOut();
        } else if (vehicle.vel) {
          // Pour l'IA, déstabilisation et dérive temporaire
          if (typeof vehicle.vel.rotate === 'function') {
            vehicle.vel.rotate(0.35);
          }
        }
      } else if (this.type === 'cone') {
        // Cône repoussant
        let repulse;
        if (typeof p5 !== 'undefined' && p5.Vector && p5.Vector.sub) {
          repulse = p5.Vector.sub(vehicle.pos, this.pos).normalize().mult(vehicle.maxforce * 2);
          vehicle.applyForce(repulse);
        }
      }
      return true;
    }
    return false;
  }

  show() {
    if (typeof push !== 'function') return;

    push();
    translate(this.pos.x, this.pos.y);

    if (this.type === 'oil') {
      // Flaque d'huile irisée violette / noire
      noStroke();
      fill(15, 23, 42, 220);
      ellipse(0, 0, this.r * 2, this.r * 1.5);

      // Reflet irisé
      fill(168, 85, 247, 90);
      ellipse(2, -2, this.r * 1.3, this.r * 0.9);
      fill(56, 189, 248, 80);
      ellipse(-3, 3, this.r * 0.8, this.r * 0.5);
    } else {
      // Cône de signalisation orange et blanc
      rotate(this.angle);
      fill(249, 115, 22);
      stroke(255, 255, 255);
      strokeWeight(1.5);
      circle(0, 0, this.r * 1.2);

      fill(255, 255, 255);
      circle(0, 0, this.r * 0.6);

      fill(249, 115, 22);
      circle(0, 0, this.r * 0.3);
    }

    pop();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Hazard };
} else {
  globalThis.Hazard = Hazard;
  if (typeof window !== 'undefined') window.Hazard = Hazard;
}
