# 🏁 Grand Prix IA — Steering Behaviors & Neuroévolution

> Un jeu et simulateur de course de Formule 1 en 2D vu de dessus, où chaque monoplace est propulsée exclusivement par des forces physiques (Craig Reynolds, 1999) et pilotée par intelligence artificielle ou au clavier.

<p align="center">
  <a href="https://medf55.github.io/simulation-f1/"><img src="https://img.shields.io/badge/%E2%96%B6%20JOUER%20EN%20LIGNE-GitHub%20Pages-e10600?style=for-the-badge&logo=github" alt="Jouer en ligne"></a>
  <a href="https://youtu.be/hwujdiXl3-0"><img src="https://img.shields.io/badge/%E2%96%B6%20D%C3%89MO%20YOUTUBE-Vid%C3%A9o%20Gameplay-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="Démo YouTube"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/p5.js-1.4.0-ED225D?logo=p5dotjs&logoColor=white" alt="p5.js">
  <img src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Web%20Audio%20API-Proc%C3%A9dural-00d2ff" alt="Web Audio">
  <img src="https://img.shields.io/badge/60%20FPS-Buffer%20Graphique-10b981" alt="60 FPS">
</p>

---

## 🎯 Présentation

**Grand Prix IA** est un projet de synthèse autour des *steering behaviors* théorisés par **Craig W. Reynolds** (*« Steering Behaviors for Autonomous Characters »*, 1999). 

Le projet respecte à la lettre la séparation conceptuelle fondamentale :
1. **Sélection de l'action / Décision** : Réseau de neurones artificiels (IA) ou commandes au clavier (Joueur).
2. **Steering (Pilotage)** : Calcul d'une force de direction $\vec{F}_{\text{steer}} = \text{limit}(\vec{v}_{\text{désirée}} - \vec{v}_{\text{actuelle}}, \text{maxForce})$.
3. **Locomotion** : Application de la force via `applyForce()` qui modifie l'accélération et la vitesse du véhicule.

Toutes les entités mobiles dérivent de la classe de base `Vehicle` (qui reste **100% intacte** conformément aux règles du projet). Le tracé du circuit est généré dynamiquement à chaque partie par un bruit de Perlin 2D fluide.

---

## ✨ Fonctionnalités

### 🏎️ Ambiance Formule 1 & Retransmission TV
- **Portique de départ officiel F1** : Séquence à 5 feux rouges progressifs avec bips sonores Web Audio, extinction simultanée (*Lights Out*) et feu vert `PARTEZ !`.
- **Aspiration aérodynamique (Slipstream)** : En se plaçant dans le sillage immédiat d'une monoplace ($\pm 28^\circ$), le véhicule gagne $+22\%$ de vitesse de pointe et déclenche des flammes d'échappement bleues.
- **Chronométrage par secteurs F1** : Découpage du circuit en secteurs **S1**, **S2** et **S3** avec télémétrie couleur officielle (🟣 violet = record absolu, 🟢 vert = record personnel).
- **Tableau des écarts en direct** : Classement calculant en continu l'intervalle en secondes avec chaque concurrent (`+1.4s`, `VOUS`, `-0.8s`).
- **Podium & Célébration** : À l'arrivée des 3 tours, affichage du Top 3 médaillé avec pluie de confettis multicolores et raccourci revanche immédiate (<kbd>R</kbd>).

### 🎮 Les 3 Modes de Jeu

| Mode | Description |
| :--- | :--- |
| **🧬 1. Laboratoire IA** | Entraînement en temps réel d'une flotte de 50 voitures par algorithme génétique. Visualiseur du réseau de neurones en direct (**HUD Cerveau**), mode **Turbo (x25)** pour franchir des générations en quelques secondes, et bouton **Réglages Parfaits** en un clic. |
| **🏎️ 2. Course Joueur vs IA** | Grand Prix sur 3 tours. Le joueur s'élance depuis la grille de départ étagée face à **7 pilotes IA** aux compétences graduées (*Max, Lewis, Fernando, Charles, Lando, Pierre, Rookie*). |
| **⏱️ 3. Contre-la-Montre Solo** | Piste 100% dégagée, dédiée au pilotage pur sans aucune IA parasite. Affichage des temps par secteurs S1/S2/S3, du tachymètre en km/h et sauvegarde du record du tour. |

### 🛞 Pilotage & Dynamique Véhicule
- **Maniabilité précise** : Décomposition physique des vitesses (traction longitudinale et adhérence latérale des pneus).
- **Traces de pneus doubles & Fumée** : En cas de dérive ou freinage appuyé, des traces de gomme parallèles et des volutes de fumée s'estompent progressivement sur l'asphalte.
- **Trajectoire Idéale F1 dynamique (<kbd>L</kbd>)** : Ligne d'assistance colorée selon la courbure (🟢 vert en ligne droite, 🟡 jaune en entrée de courbe, 🔴 rouge au point de corde).
- **6 Livrées personnalisables (<kbd>C</kbd>)** : *Cyan Néon, Rouge Écarlate, Vert Fluo, Doré Champion, Violet Cyberpunk, Noir Carbone*.
- **Caméra de poursuite dynamique (<kbd>V</kbd>)** : Suivi centré et zoomé sur le bolide.
- **Synthèse sonore procédurale (`sound.js`)** : Moteur dynamique, crissements de pneus, bips de départ F1 et fanfares générés via la Web Audio API (aucun fichier MP3/WAV lourd à charger).
- **Buffer Graphique 60 FPS (`trackBuffer`)** : Circuit pré-dessiné hors-écran dans un buffer `p5.Graphics`, garantissant une fluidité maximale.

---

## 🧠 Comment ça marche ?

### 1. Les Steering Behaviors Réactifs
À chaque pas de simulation (60 FPS), le véhicule calcule et compose ses forces de pilotage :
- **Seek (Visée)** : Construire une vitesse désirée orientée vers le checkpoint suivant et appliquer la force correctrice.
- **Arrive (Freinage)** : Décélérer en entrée de virage serré pour respecter le rayon de courbure.
- **Séparation (Flocking Reynolds)** : Répulsion locale inversement proportionnelle à la distance ($r \le 24\text{ px}$) pour éviter les chevauchements en peloton.
- **Aspiration (Slipstream)** : Force d'attraction vers l'avant lorsqu'un bolide se trouve dans le sillage d'un autre.
- **Perception par Raycasting (`ray.js`)** : 5 à 7 rayons de capteurs mesurent en permanence la distance exacte aux bordures du circuit.

### 2. Le Réseau de Neurones & l'Algorithme Génétique
Dans le mode Évolution, le pilotage est confié à un **Perceptron Multi-Couches** (`nn.js`) :

```text
Capteurs Raycasting (5 à 7 rayons)  ───►  Couche Cachée (10 neurones tanh)  ───►  Sorties (2 neurones)
(+ capteur optionnel de vitesse)                                                   ├── Braquage (gauche / droite)
                                                                                  └── Propulsion / Freinage
```

- **Fitness continue** : Récompense la progression exacte sur la piste :
  $$\text{Fitness} = (\text{Tours} \times 1000) + (\text{Checkpoints} \times 10) + \left(1 - \frac{d(\vec{p}, \text{cp}_{\text{next}})}{\text{distance tronçon}}\right)$$
- **Élitisme** : Les 2 meilleurs champions de chaque génération sont conservés sans mutation.
- **Sélection naturelle & Mutation** : Tirage par roulette pondérée et mutation gaussienne des poids synaptiques.
- **Persistance LocalStorage** : Possibilité de sauvegarder et charger le champion IA pour courir contre son propre fantôme (*Ghost*).

---

## ⌨️ Contrôles & Raccourcis

Le jeu se pilote au clavier (**AZERTY** ou **QWERTY** / **Flèches**).

### Pilotage du Véhicule (Modes 2 & 3)

| Action | Touches |
| :--- | :--- |
| **Accélérer** | `Z`, `W` ou `↑` |
| **Freiner / Marche arrière** | `S` ou `↓` |
| **Braquer à gauche / droite** | `Q` / `D`, `A` / `D` ou `←` / `→` |

### Assistance, Caméra & Jeu

| Action | Touche |
| :--- | :---: |
| **Trajectoire idéale F1 (vert / jaune / rouge)** | <kbd>L</kbd> |
| **Changer la livrée / couleur du bolide** | <kbd>C</kbd> |
| **Revanche départ arrêté / Réinitialiser** | <kbd>R</kbd> |
| **Caméra poursuite dynamique ↔ Vue d'ensemble** | <kbd>V</kbd> |
| **Activer / Couper le son** | <kbd>M</kbd> |
| **Nouveau circuit procédural aléatoire** | <kbd>B</kbd> |
| **Mode Turbo (x25)** *(Mode 1)* | <kbd>T</kbd> |
| **Mode Debug (rayons de vision & checkpoints)** | <kbd>D</kbd> ou <kbd>X</kbd> |
| **Afficher / Masquer le panneau latéral** | <kbd>H</kbd> |
| **Pause / Reprendre** | <kbd>Espace</kbd> |
| **Sélectionner un mode de jeu** | <kbd>1</kbd>, <kbd>2</kbd> ou <kbd>3</kbd> |

---

## 🚀 Lancement en Local

### Prérequis
- Un navigateur web moderne (Chrome, Firefox, Edge, Safari).
- **Python 3** ou **Node.js** (recommandé pour servir les fichiers web sans restriction CORS de polices).

### Lancer la simulation

Dans un terminal ouvert dans le dossier du projet :

```bash
# Avec Python
python -m http.server 8080

# Ou avec Node.js (npx)
npx serve -l 8080 .
```

Ouvrez ensuite votre navigateur sur **`http://localhost:8080/`** (ou double-cliquez directement sur **`start.bat`**).

---

## 🗂️ Architecture des Fichiers

```text
simulation-f1/            (Dépôt GitHub autonome)
├── index.html            Interface moderne, bandeau télémétrie et HUD
├── sketch.js             Boucle p5.js, 3 modes de jeu, portique F1, caméra et podium
├── vehicle.js            Classe Vehicle de base de Reynolds (protégée, 100% intacte)
├── car.js                Classe CarVehicle : monoplaces IA guidées par réseau de neurones
├── playerCar.js          Classe PlayerCar : voiture pilotable, traces de pneus, fumée, livrées
├── hazard.js             Classe Hazard : obstacles et flaques déstabilisantes
├── nn.js                 Perceptron multi-couches (1-3 couches cachées, tanh/relu/sigmoid)
├── ga.js                 Algorithme génétique : fitness continue, sélection, élitisme, mutation
├── sound.js              Synthétiseur Web Audio API procédural sans dépendance externe
├── style.css             Design sombre F1 épuré, typographies Google Fonts et animations
├── boundary.js           Murs et segments de circuit
├── ray.js                Raycasting et détection d'intersection
├── start.bat             Lanceur local Windows en 1 clic
└── README.md             Documentation complète du projet
```

### 🔒 La Règle d'Architecture Fondamentale
**Toute entité mobile étend `Vehicle` et n'est guidée que par des forces**. Le joueur, les monoplaces IA, les obstacles et les fantômes ne modifient jamais directement leur position ou leur vitesse : ils délèguent l'intégration physique à `applyForce()` hérité de `vehicle.js`.

---

