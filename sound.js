/**
 * SoundEffects - Synthétiseur audio procédural Web Audio API.
 * Génère dynamiquement les sons de course (moteur, dérapage, checkpoint, crash, fanfare)
 * sans dépendance externe ni fichier audio lourd, pour une performance optimale à 60 FPS.
 */

class SoundManager {
  constructor() {
    this.ctx = null;
    this.isMuted = true; // Muet par défaut pour respecter les politiques navigateurs
    this.engineOsc = null;
    this.engineGain = null;
    this.lastEngineRpm = 0;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    } catch (e) {
      // Environnement sans audio ou bloqué
    }
  }

  ensureContext() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.ensureContext();
    if (this.isMuted && this.engineGain) {
      this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    return !this.isMuted;
  }

  playCheckpointDing() {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime); // La 5
      osc.frequency.exponentialRampToValueAtTime(1320, this.ctx.currentTime + 0.08); // Mi 6

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    } catch (e) {}
  }

  playLapFanfare() {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // Do, Mi, Sol, Do
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.07);

        gain.gain.setValueAtTime(0.12, this.ctx.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.07 + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + idx * 0.07);
        osc.stop(this.ctx.currentTime + idx * 0.07 + 0.25);
      });
    } catch (e) {}
  }

  playTireScreech() {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400 + Math.random() * 80, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(320, this.ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);
    } catch (e) {}
  }

  playF1Beep(isLaunch = false) {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = isLaunch ? 'triangle' : 'sine';
      const freq = isLaunch ? 880 : 440;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(isLaunch ? 0.16 : 0.10, this.ctx.currentTime);
      const dur = isLaunch ? 0.28 : 0.08;
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    } catch (e) {}
  }

  playDraftWhoosh() {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.18);
    } catch (e) {}
  }

  playCrashThump() {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(35, this.ctx.currentTime + 0.22);

      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.22);
    } catch (e) {}
  }

  updateEngine(speedRatio = 0) {
    if (this.isMuted || !this.ctx) return;
    try {
      this.ensureContext();
      if (!this.engineOsc) {
        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        this.engineOsc.type = 'triangle';
        this.engineOsc.frequency.setValueAtTime(55, this.ctx.currentTime);
        this.engineGain.gain.setValueAtTime(0.02, this.ctx.currentTime);
        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);
        this.engineOsc.start();
      }

      const targetFreq = 45 + Math.min(1.0, speedRatio) * 160;
      this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.05);
      this.engineGain.gain.setTargetAtTime(0.015 + speedRatio * 0.03, this.ctx.currentTime, 0.05);
    } catch (e) {}
  }
}

const sounds = new SoundManager();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SoundManager, sounds };
} else {
  globalThis.sounds = sounds;
}
