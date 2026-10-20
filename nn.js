/**
 * Réseau de neurones multi-couches configurable pour la voiture autonome.
 * Utilise TensorFlow.js (avec support multi-couches cachées, activations configurables
 * et zéro fuite mémoire via tf.tidy) et propose un fallback matriciel haute performance
 * pour les tests automatisés Node.js.
 */
class NeuralNetwork {
  constructor(a, b, c, d, e = 'tanh') {
    if (a && typeof a.predict === 'function' && typeof a.getWeights === 'function') {
      this.model = a;
      this.input_nodes = b;
      this.hidden_layers = Array.isArray(c) ? c : [c];
      this.output_nodes = d;
      this.activation = e || 'tanh';
      this.weights = this.initFallbackWeights();
    } else if (typeof tf !== 'undefined' && tf && typeof tf.sequential === 'function') {
      try {
        this.input_nodes = a;
        this.hidden_layers = Array.isArray(b) ? b : [b];
        this.output_nodes = c;
        this.activation = d || 'tanh';
        this.model = this.createModel();
        this.weights = this.initFallbackWeights();
      } catch (err) {
        // Fallback matriciel si TensorFlow.js rencontre une restriction ou erreur
        this.model = null;
        this.weights = this.initFallbackWeights();
      }
    } else {
      // Fallback JS matriciel haute performance
      this.input_nodes = a;
      this.hidden_layers = Array.isArray(b) ? b : [b];
      this.output_nodes = c;
      this.activation = d || 'tanh';
      this.weights = this.initFallbackWeights();
    }
  }

  createModel() {
    const model = tf.sequential();
    const hidden = this.hidden_layers;

    // 1ère couche cachée (connectée aux inputs)
    model.add(tf.layers.dense({
      units: hidden[0] || 8,
      inputShape: [this.input_nodes],
      activation: this.activation === 'relu' ? 'relu' : (this.activation === 'sigmoid' ? 'sigmoid' : 'tanh')
    }));

    // Couches cachées supplémentaires si configurées
    for (let i = 1; i < hidden.length; i++) {
      model.add(tf.layers.dense({
        units: hidden[i],
        activation: this.activation === 'relu' ? 'relu' : (this.activation === 'sigmoid' ? 'sigmoid' : 'tanh')
      }));
    }

    // Couche de sortie : 2 neurones (direction [-1, 1] ou [0, 1], et vitesse [0, 1])
    model.add(tf.layers.dense({
      units: this.output_nodes,
      activation: 'sigmoid'
    }));

    return model;
  }

  predict(inputs) {
    if (typeof tf !== 'undefined' && this.model) {
      try {
        return tf.tidy(() => {
          const xs = tf.tensor2d([inputs]);
          const ys = this.model.predict(xs);
          const outputs = ys.dataSync();
          return Array.from(outputs);
        });
      } catch (err) {
        // En cas de layer disposed ou anomalie TensorFlow, basculement transparent sur le fallback
        return this.predictFallback(inputs);
      }
    }

    // Calcul matriciel rapide en mode fallback
    return this.predictFallback(inputs);
  }

  copy() {
    if (typeof tf !== 'undefined' && this.model) {
      try {
        const modelCopy = this.createModel();
        const weights = this.model.getWeights();
        const weightCopies = [];
        for (let i = 0; i < weights.length; i++) {
          weightCopies[i] = weights[i].clone();
        }
        modelCopy.setWeights(weightCopies);
        const copyNN = new NeuralNetwork(modelCopy, this.input_nodes, [...this.hidden_layers], this.output_nodes, this.activation);
        if (this.weights) {
          copyNN.weights = this.weights.map(layer => layer.map(row => (Array.isArray(row) ? [...row] : row)));
        }
        return copyNN;
      } catch (err) {
        // En cas d'erreur de clonage TensorFlow, basculement en copie matricielle
      }
    }

    // Copie fallback
    const copyNN = new NeuralNetwork(this.input_nodes, [...this.hidden_layers], this.output_nodes, this.activation);
    if (this.weights) {
      copyNN.weights = this.weights.map(layer => layer.map(row => (Array.isArray(row) ? [...row] : row)));
    }
    return copyNN;
  }

  mutate(rate) {
    if (typeof tf !== 'undefined' && this.model) {
      try {
        tf.tidy(() => {
          const weights = this.model.getWeights();
          const mutatedWeights = [];

          for (let i = 0; i < weights.length; i++) {
            let tensor = weights[i];
            let shape = tensor.shape;
            let values = tensor.dataSync().slice();

            for (let j = 0; j < values.length; j++) {
              if (Math.random() < rate) {
                const randG = this.gaussianRandom();
                values[j] += randG * 0.5;
              }
            }

            mutatedWeights[i] = tf.tensor(values, shape);
          }

          this.model.setWeights(mutatedWeights);
        });
        return;
      } catch (e) {
        // Fallback en cas d'erreur
      }
    }

    // Mutation fallback
    for (let layer of this.weights) {
      for (let i = 0; i < layer.length; i++) {
        if (Array.isArray(layer[i])) {
          for (let j = 0; j < layer[i].length; j++) {
            if (Math.random() < rate) layer[i][j] += this.gaussianRandom() * 0.5;
          }
        } else {
          if (Math.random() < rate) layer[i] += this.gaussianRandom() * 0.5;
        }
      }
    }
  }

  gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  dispose() {
    if (typeof tf !== 'undefined' && this.model) {
      try {
        if (!this.model.isDisposed) {
          this.model.dispose();
        }
      } catch (e) {
        // Ignorer si déjà disposé
      }
      this.model = null;
    }
  }

  getTopology() {
    return {
      inputNodes: this.input_nodes,
      hiddenLayers: [...this.hidden_layers],
      outputNodes: this.output_nodes,
      activation: this.activation
    };
  }

  // --- Implémentation matricielle légère pour fallback & tests ---
  initFallbackWeights() {
    const layers = [];
    let prev = this.input_nodes;
    for (const h of this.hidden_layers) {
      const w = [];
      for (let i = 0; i < h; i++) {
        const row = [];
        for (let j = 0; j < prev; j++) row.push((Math.random() * 2 - 1) * Math.sqrt(2 / prev));
        w.push(row);
      }
      layers.push(w);
      prev = h;
    }
    const outW = [];
    for (let i = 0; i < this.output_nodes; i++) {
      const row = [];
      for (let j = 0; j < prev; j++) row.push((Math.random() * 2 - 1) * Math.sqrt(2 / prev));
      outW.push(row);
    }
    layers.push(outW);
    return layers;
  }

  predictFallback(inputs) {
    let current = [...inputs];
    for (let l = 0; l < this.weights.length; l++) {
      const layerW = this.weights[l];
      const next = [];
      const isOutput = (l === this.weights.length - 1);
      for (let i = 0; i < layerW.length; i++) {
        let sum = 0;
        for (let j = 0; j < current.length; j++) {
          sum += (current[j] || 0) * (layerW[i][j] || 0);
        }
        if (isOutput) {
          next.push(1 / (1 + Math.exp(-sum))); // Sigmoid de sortie
        } else {
          next.push(this.activation === 'relu' ? Math.max(0, sum) : Math.tanh(sum));
        }
      }
      current = next;
    }
    return current;
  }

  serialize() {
    let weightsData = [];
    if (typeof tf !== 'undefined' && this.model) {
      const tensors = this.model.getWeights();
      weightsData = tensors.map(t => ({
        shape: t.shape,
        values: Array.from(t.dataSync())
      }));
    } else {
      weightsData = this.weights;
    }
    return JSON.stringify({
      inputNodes: this.input_nodes,
      hiddenLayers: this.hidden_layers,
      outputNodes: this.output_nodes,
      activation: this.activation,
      weights: weightsData,
      isTf: !!(typeof tf !== 'undefined' && this.model)
    });
  }

  static deserialize(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const nn = new NeuralNetwork(data.inputNodes, data.hiddenLayers, data.outputNodes, data.activation);
    if (data.isTf && typeof tf !== 'undefined' && nn.model && Array.isArray(data.weights)) {
      const tensors = data.weights.map(w => tf.tensor(w.values, w.shape));
      nn.model.setWeights(tensors);
    } else if (Array.isArray(data.weights)) {
      nn.weights = data.weights;
    }
    return nn;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NeuralNetwork };
}