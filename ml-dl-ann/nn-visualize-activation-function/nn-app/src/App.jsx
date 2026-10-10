import { useState, useRef, useCallback, useEffect } from "react";

// ─── Utility Functions ───
const sigmoid = (x) => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
const sigmoidDeriv = (x) => x * (1 - x);
const relu = (x) => Math.max(0, x);
const reluDeriv = (x) => (x > 0 ? 1 : 0);
const tanh_ = (x) => Math.tanh(x);
const tanhDeriv = (x) => 1 - x * x;

const ACTIVATIONS = {
  sigmoid: { fn: sigmoid, deriv: sigmoidDeriv },
  relu: { fn: relu, deriv: reluDeriv },
  tanh: { fn: tanh_, deriv: tanhDeriv },
};

// ─── Dataset Generators ───
function generateXOR(n = 200) {
  const data = [];
  for (let i = 0; i < n; i++) {
    const x1 = Math.random() > 0.5 ? 1 : 0;
    const x2 = Math.random() > 0.5 ? 1 : 0;
    data.push({ input: [x1, x2], label: x1 ^ x2 });
  }
  return data;
}

function generateCircle(n = 200) {
  const data = [];
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const label = x * x + y * y < 0.5 ? 1 : 0;
    data.push({ input: [x, y], label });
  }
  return data;
}

function generateSpiral(n = 200) {
  const data = [];
  for (let i = 0; i < n / 2; i++) {
    const r = (i / (n / 2)) * 5;
    const t = (1.75 * i) / (n / 2) * 2 * Math.PI + Math.random() * 0.3;
    data.push({ input: [r * Math.cos(t) / 5, r * Math.sin(t) / 5], label: 0 });
    data.push({ input: [-r * Math.cos(t) / 5, -r * Math.sin(t) / 5], label: 1 });
  }
  return data;
}

// ─── Neural Network Class ───
class NeuralNetwork {
  constructor(layerSizes, activation = "sigmoid", learningRate = 0.5) {
    this.layerSizes = layerSizes;
    this.activation = activation;
    this.lr = learningRate;
    this.weights = [];
    this.biases = [];
    this.initWeights();
  }

  initWeights() {
    this.weights = [];
    this.biases = [];
    for (let i = 0; i < this.layerSizes.length - 1; i++) {
      const fanIn = this.layerSizes[i];
      const fanOut = this.layerSizes[i + 1];
      const scale = Math.sqrt(2 / (fanIn + fanOut));
      const w = [];
      for (let j = 0; j < fanOut; j++) {
        const row = [];
        for (let k = 0; k < fanIn; k++) {
          row.push((Math.random() * 2 - 1) * scale);
        }
        w.push(row);
      }
      this.weights.push(w);
      this.biases.push(new Array(fanOut).fill(0).map(() => (Math.random() * 0.2 - 0.1)));
    }
  }

  forward(input) {
    const act = ACTIVATIONS[this.activation];
    const activations = [input.slice()];
    const preActivations = [input.slice()];
    let current = input.slice();

    for (let l = 0; l < this.weights.length; l++) {
      const next = [];
      const pre = [];
      for (let j = 0; j < this.weights[l].length; j++) {
        let sum = this.biases[l][j];
        for (let k = 0; k < current.length; k++) {
          sum += this.weights[l][j][k] * current[k];
        }
        pre.push(sum);
        const isOutput = l === this.weights.length - 1;
        next.push(isOutput ? sigmoid(sum) : act.fn(sum));
      }
      preActivations.push(pre);
      activations.push(next);
      current = next;
    }
    return { activations, preActivations };
  }

  backward(input, label) {
    const { activations, preActivations } = this.forward(input);
    const act = ACTIVATIONS[this.activation];
    const numLayers = this.weights.length;
    const deltas = new Array(numLayers);
    const gradients = [];

    // Output layer delta
    const outputLayer = numLayers;
    const outputDeltas = [];
    for (let j = 0; j < this.layerSizes[this.layerSizes.length - 1]; j++) {
      const output = activations[outputLayer][j];
      const error = output - label;
      outputDeltas.push(error * sigmoidDeriv(output));
    }
    deltas[numLayers - 1] = outputDeltas;

    // Hidden layer deltas
    for (let l = numLayers - 2; l >= 0; l--) {
      const layerDeltas = [];
      for (let j = 0; j < this.layerSizes[l + 1]; j++) {
        let error = 0;
        for (let k = 0; k < this.layerSizes[l + 2]; k++) {
          error += deltas[l + 1][k] * this.weights[l + 1][k][j];
        }
        layerDeltas.push(error * act.deriv(activations[l + 1][j]));
      }
      deltas[l] = layerDeltas;
    }

    // Compute gradients and update weights
    for (let l = 0; l < numLayers; l++) {
      const layerGrad = [];
      for (let j = 0; j < this.weights[l].length; j++) {
        const neuronGrad = [];
        for (let k = 0; k < this.weights[l][j].length; k++) {
          const grad = deltas[l][j] * activations[l][k];
          neuronGrad.push(grad);
          this.weights[l][j][k] -= this.lr * grad;
        }
        layerGrad.push(neuronGrad);
        this.biases[l][j] -= this.lr * deltas[l][j];
      }
      gradients.push(layerGrad);
    }

    return { activations, deltas, gradients };
  }

  trainEpoch(data) {
    let totalLoss = 0;
    let lastResult = null;
    for (const sample of data) {
      lastResult = this.backward(sample.input, sample.label);
      const output = lastResult.activations[lastResult.activations.length - 1][0];
      totalLoss += -(sample.label * Math.log(output + 1e-10) + (1 - sample.label) * Math.log(1 - output + 1e-10));
    }
    return { loss: totalLoss / data.length, lastResult };
  }

  predict(input) {
    const { activations } = this.forward(input);
    return activations[activations.length - 1][0];
  }

  getMetrics(data) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const sample of data) {
      const pred = this.predict(sample.input) >= 0.5 ? 1 : 0;
      if (pred === 1 && sample.label === 1) tp++;
      else if (pred === 1 && sample.label === 0) fp++;
      else if (pred === 0 && sample.label === 1) fn++;
      else tn++;
    }
    const accuracy = (tp + tn) / (tp + fp + fn + tn);
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
    return { accuracy, precision, recall, f1, specificity, tp, fp, fn, tn };
  }

  getWeightsSnapshot() {
    return this.weights.map(layer => layer.map(row => [...row]));
  }
}

// ─── NetworkGraph SVG Component ───
function NetworkGraph({ network, lastResult, stepPhase }) {
  if (!network) return null;
  const layers = network.layerSizes;
  const W = 520;
  const H = 280;
  const padX = 60;
  const padY = 30;
  const layerSpacing = (W - 2 * padX) / (layers.length - 1);

  const positions = layers.map((size, li) => {
    const x = padX + li * layerSpacing;
    const totalH = H - 2 * padY;
    const spacing = totalH / (size + 1);
    return Array.from({ length: size }, (_, ni) => ({
      x,
      y: padY + spacing * (ni + 1),
    }));
  });

  const activations = lastResult?.activations;
  const gradients = lastResult?.gradients;
  const isForward = stepPhase === "forward";
  const isBackward = stepPhase === "backward";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="forwardGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#06b6d4" stopOpacity="1" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="backwardGrad" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#f97316" stopOpacity="1" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Connections */}
      {network.weights.map((layer, li) =>
        layer.map((row, j) =>
          row.map((w, k) => {
            const from = positions[li][k];
            const to = positions[li + 1][j];
            const absW = Math.abs(w);
            const opacity = Math.min(0.15 + absW * 0.6, 0.9);
            const strokeW = Math.min(0.5 + absW * 2.5, 4);
            const color = w > 0 ? "#22d3ee" : "#fb923c";
            const showGrad = isBackward && gradients && gradients[li];
            const gradVal = showGrad ? Math.abs(gradients[li][j]?.[k] || 0) : 0;
            return (
              <g key={`${li}-${j}-${k}`}>
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={color} strokeWidth={strokeW} opacity={opacity}
                  strokeLinecap="round"
                />
                {isForward && (
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="url(#forwardGrad)" strokeWidth={strokeW + 1}
                    opacity={0.6} strokeLinecap="round"
                  >
                    <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />
                    <set attributeName="stroke-dasharray" to="4 16" />
                  </line>
                )}
                {isBackward && gradVal > 0.001 && (
                  <line
                    x1={to.x} y1={to.y} x2={from.x} y2={from.y}
                    stroke="url(#backwardGrad)" strokeWidth={Math.min(1 + gradVal * 10, 5)}
                    opacity={0.7} strokeLinecap="round"
                  >
                    <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite" />
                    <set attributeName="stroke-dasharray" to="3 12" />
                  </line>
                )}
              </g>
            );
          })
        )
      )}

      {/* Neurons */}
      {positions.map((layer, li) =>
        layer.map((pos, ni) => {
          const activation = activations ? activations[li][ni] : 0.5;
          const brightness = Math.min(Math.max(activation, 0), 1);
          const r = li === 0 ? 12 : li === layers.length - 1 ? 14 : 10;
          const isInput = li === 0;
          const isOutput = li === layers.length - 1;
          const fill = isOutput
            ? `rgb(${Math.round(59 + brightness * 140)}, ${Math.round(130 + brightness * 70)}, ${Math.round(246 - brightness * 50)})`
            : isInput
            ? `rgb(${Math.round(20 + brightness * 80)}, ${Math.round(184 + brightness * 40)}, ${Math.round(166 + brightness * 60)})`
            : `rgb(${Math.round(100 + brightness * 155)}, ${Math.round(60 + brightness * 120)}, ${Math.round(200 + brightness * 55)})`;
          return (
            <g key={`n-${li}-${ni}`}>
              <circle cx={pos.x} cy={pos.y} r={r + 3} fill={fill} opacity={0.15} />
              <circle
                cx={pos.x} cy={pos.y} r={r}
                fill={fill} stroke="#1e293b" strokeWidth="1.5"
                filter={isForward || isBackward ? "url(#glow)" : undefined}
              />
              <text
                x={pos.x} y={pos.y + 1}
                textAnchor="middle" dominantBaseline="middle"
                fill="#e2e8f0" fontSize="7" fontFamily="'JetBrains Mono', monospace" fontWeight="600"
              >
                {activation !== undefined ? activation.toFixed(2) : ""}
              </text>
            </g>
          );
        })
      )}

      {/* Layer Labels */}
      {positions.map((layer, li) => (
        <text
          key={`label-${li}`}
          x={layer[0].x}
          y={H - 6}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="9"
          fontFamily="'JetBrains Mono', monospace"
        >
          {li === 0 ? "Input" : li === layers.length - 1 ? "Output" : `Hidden ${li}`}
        </text>
      ))}
    </svg>
  );
}

// ─── Weight Matrix Display ───
function WeightMatrix({ network }) {
  if (!network) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
      {network.weights.map((layer, li) => (
        <div key={li}>
          <div style={{ color: "#94a3b8", marginBottom: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
            Layer {li} → {li + 1} weights
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${layer[0].length}, 1fr)`,
            gap: 2,
          }}>
            {layer.map((row, j) =>
              row.map((w, k) => {
                const absW = Math.min(Math.abs(w), 2);
                const intensity = absW / 2;
                const bg = w > 0
                  ? `rgba(34, 211, 238, ${0.1 + intensity * 0.5})`
                  : `rgba(251, 146, 60, ${0.1 + intensity * 0.5})`;
                return (
                  <div
                    key={`${j}-${k}`}
                    style={{
                      background: bg,
                      borderRadius: 3,
                      padding: "2px 3px",
                      textAlign: "center",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      color: "#e2e8f0",
                      border: "1px solid rgba(148, 163, 184, 0.1)",
                    }}
                    title={`w[${li}][${j}][${k}] = ${w.toFixed(6)}`}
                  >
                    {w.toFixed(3)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Mini Loss Chart ───
function LossChart({ history }) {
  if (history.length < 2) return <div style={{ color: "#64748b", fontSize: 11, padding: 12 }}>Training will show loss curve here...</div>;
  const W = 320;
  const H = 120;
  const pad = { t: 10, r: 10, b: 20, l: 35 };
  const maxLoss = Math.max(...history.map(h => h.loss), 0.01);
  const minLoss = Math.min(...history.map(h => h.loss), 0);
  const range = maxLoss - minLoss || 1;
  const points = history.map((h, i) => {
    const x = pad.l + (i / (history.length - 1)) * (W - pad.l - pad.r);
    const y = pad.t + (1 - (h.loss - minLoss) / range) * (H - pad.t - pad.b);
    return `${x},${y}`;
  }).join(" ");

  const accPoints = history.map((h, i) => {
    const x = pad.l + (i / (history.length - 1)) * (W - pad.l - pad.r);
    const y = pad.t + (1 - h.accuracy) * (H - pad.t - pad.b);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 120 }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = pad.t + t * (H - pad.t - pad.b);
        return <line key={t} x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="#1e293b" strokeWidth="0.5" />;
      })}
      <text x={2} y={pad.t + 4} fill="#64748b" fontSize="8" fontFamily="'JetBrains Mono', monospace">{maxLoss.toFixed(2)}</text>
      <text x={2} y={H - pad.b} fill="#64748b" fontSize="8" fontFamily="'JetBrains Mono', monospace">{minLoss.toFixed(2)}</text>

      {/* Loss line */}
      <polyline points={points} fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Accuracy line */}
      <polyline points={accPoints} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />

      {/* Legend */}
      <line x1={pad.l} y1={H - 5} x2={pad.l + 15} y2={H - 5} stroke="#f43f5e" strokeWidth="1.5" />
      <text x={pad.l + 18} y={H - 2} fill="#f43f5e" fontSize="8" fontFamily="'JetBrains Mono', monospace">Loss</text>
      <line x1={pad.l + 55} y1={H - 5} x2={pad.l + 70} y2={H - 5} stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x={pad.l + 73} y={H - 2} fill="#22d3ee" fontSize="8" fontFamily="'JetBrains Mono', monospace">Accuracy</text>
    </svg>
  );
}

// ─── Confusion Matrix ───
function ConfusionMatrix({ metrics }) {
  if (!metrics) return null;
  const { tp, fp, fn, tn } = metrics;
  const cells = [
    { label: "TP", value: tp, color: "#22d3ee" },
    { label: "FP", value: fp, color: "#fb923c" },
    { label: "FN", value: fn, color: "#fb923c" },
    { label: "TN", value: tn, color: "#22d3ee" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, maxWidth: 140 }}>
      {cells.map(c => (
        <div key={c.label} style={{
          background: `${c.color}15`,
          border: `1px solid ${c.color}30`,
          borderRadius: 4,
          padding: "4px 6px",
          textAlign: "center",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <div style={{ fontSize: 8, color: "#94a3b8" }}>{c.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ───
export default function NeuralNetworkLab() {
  const [config, setConfig] = useState({
    layers: [2, 4, 4, 1],
    activation: "sigmoid",
    learningRate: 0.5,
    dataset: "xor",
    epochs: 100,
  });
  const [layerInput, setLayerInput] = useState("2, 4, 4, 1");
  const [network, setNetwork] = useState(null);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [stepPhase, setStepPhase] = useState(null);
  const [isTraining, setIsTraining] = useState(false);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [epochLog, setEpochLog] = useState([]);
  const trainRef = useRef(false);
  const netRef = useRef(null);

  const getDataset = useCallback(() => {
    if (config.dataset === "xor") return generateXOR(200);
    if (config.dataset === "circle") return generateCircle(200);
    return generateSpiral(200);
  }, [config.dataset]);

  const initNetwork = useCallback(() => {
    const nn = new NeuralNetwork(config.layers, config.activation, config.learningRate);
    netRef.current = nn;
    setNetwork({ ...nn });
    setHistory([]);
    setMetrics(null);
    setLastResult(null);
    setStepPhase(null);
    setCurrentEpoch(0);
    setEpochLog([]);
  }, [config]);

  useEffect(() => { initNetwork(); }, []);

  const stepForward = () => {
    if (!netRef.current) return;
    const data = getDataset();
    const sample = data[Math.floor(Math.random() * data.length)];
    const result = netRef.current.forward(sample.input);
    setLastResult({ activations: result.activations });
    setStepPhase("forward");
    setNetwork({ ...netRef.current });
  };

  const stepBackward = () => {
    if (!netRef.current) return;
    const data = getDataset();
    const sample = data[Math.floor(Math.random() * data.length)];
    const result = netRef.current.backward(sample.input, sample.label);
    setLastResult(result);
    setStepPhase("backward");
    setNetwork({ ...netRef.current });
    const m = netRef.current.getMetrics(data);
    setMetrics(m);
  };

  const trainOneEpoch = () => {
    if (!netRef.current) return;
    const data = getDataset();
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    const { loss, lastResult: lr } = netRef.current.trainEpoch(shuffled);
    const m = netRef.current.getMetrics(data);
    const newEpoch = currentEpoch + 1;
    setCurrentEpoch(newEpoch);
    setHistory(prev => [...prev, { epoch: newEpoch, loss, accuracy: m.accuracy }]);
    setMetrics(m);
    setLastResult(lr);
    setStepPhase("forward");
    setNetwork({ ...netRef.current });
    setEpochLog(prev => [...prev.slice(-19), {
      epoch: newEpoch, loss: loss.toFixed(4), acc: (m.accuracy * 100).toFixed(1),
      f1: m.f1.toFixed(3), prec: m.precision.toFixed(3), rec: m.recall.toFixed(3),
    }]);
  };

  const trainAll = async () => {
    if (!netRef.current) return;
    trainRef.current = true;
    setIsTraining(true);
    const data = getDataset();

    for (let e = 0; e < config.epochs && trainRef.current; e++) {
      const shuffled = [...data].sort(() => Math.random() - 0.5);
      const { loss, lastResult: lr } = netRef.current.trainEpoch(shuffled);
      const m = netRef.current.getMetrics(data);
      const newEpoch = currentEpoch + e + 1;

      setCurrentEpoch(newEpoch);
      setHistory(prev => [...prev, { epoch: newEpoch, loss, accuracy: m.accuracy }]);
      setMetrics(m);
      setLastResult(lr);
      setStepPhase(e % 2 === 0 ? "forward" : "backward");
      setNetwork({ ...netRef.current });

      if (e % 5 === 0 || e === config.epochs - 1) {
        setEpochLog(prev => [...prev.slice(-19), {
          epoch: newEpoch, loss: loss.toFixed(4), acc: (m.accuracy * 100).toFixed(1),
          f1: m.f1.toFixed(3), prec: m.precision.toFixed(3), rec: m.recall.toFixed(3),
        }]);
      }
      await new Promise(r => setTimeout(r, 30));
    }
    setIsTraining(false);
    trainRef.current = false;
  };

  const stopTraining = () => { trainRef.current = false; setIsTraining(false); };

  const handleLayerChange = (val) => {
    setLayerInput(val);
    const parts = val.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0 && n <= 8);
    if (parts.length >= 2 && parts[0] === 2 && parts[parts.length - 1] === 1) {
      setConfig(c => ({ ...c, layers: parts }));
    }
  };

  const FONT = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";
  const DISPLAY_FONT = "'Space Grotesk', 'DM Sans', sans-serif";

  const panelStyle = {
    background: "rgba(15, 23, 42, 0.6)",
    border: "1px solid rgba(148, 163, 184, 0.08)",
    borderRadius: 10,
    padding: 14,
    backdropFilter: "blur(10px)",
  };

  const labelStyle = {
    fontFamily: FONT, fontSize: 10, color: "#64748b",
    textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4,
  };

  const inputStyle = {
    background: "rgba(30, 41, 59, 0.8)",
    border: "1px solid rgba(148, 163, 184, 0.15)",
    borderRadius: 6, padding: "6px 10px",
    color: "#e2e8f0", fontFamily: FONT, fontSize: 12,
    width: "100%", outline: "none",
  };

  const btnBase = {
    fontFamily: FONT, fontSize: 11, fontWeight: 600,
    border: "none", borderRadius: 6, padding: "7px 14px",
    cursor: "pointer", transition: "all 0.15s",
    letterSpacing: 0.5,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0b0f1a 0%, #0f172a 40%, #0c1220 100%)",
      color: "#e2e8f0",
      fontFamily: FONT,
      padding: "16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <h1 style={{
          fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 700, margin: 0,
          background: "linear-gradient(135deg, #22d3ee, #a78bfa, #f43f5e)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          Neural Network Lab
        </h1>
        <p style={{ color: "#475569", fontSize: 11, margin: "4px 0 0" }}>
          Interactive feedforward &amp; backpropagation visualizer
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 220px", gap: 12, maxWidth: 1200, margin: "0 auto" }}>
        {/* LEFT: Config */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={panelStyle}>
            <div style={labelStyle}>Architecture</div>
            <input
              value={layerInput}
              onChange={e => handleLayerChange(e.target.value)}
              style={inputStyle}
              placeholder="2, 4, 4, 1"
            />
            <div style={{ color: "#475569", fontSize: 9, marginTop: 3 }}>Must start with 2, end with 1</div>
          </div>

          <div style={panelStyle}>
            <div style={labelStyle}>Activation</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["sigmoid", "relu", "tanh"].map(a => (
                <button key={a} onClick={() => setConfig(c => ({ ...c, activation: a }))} style={{
                  ...btnBase, flex: 1, padding: "5px 6px", fontSize: 10,
                  background: config.activation === a ? "rgba(34, 211, 238, 0.2)" : "rgba(30, 41, 59, 0.5)",
                  color: config.activation === a ? "#22d3ee" : "#64748b",
                  border: config.activation === a ? "1px solid rgba(34, 211, 238, 0.3)" : "1px solid rgba(148, 163, 184, 0.1)",
                }}>
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div style={panelStyle}>
            <div style={labelStyle}>Learning Rate: {config.learningRate}</div>
            <input type="range" min="0.01" max="2" step="0.01"
              value={config.learningRate}
              onChange={e => setConfig(c => ({ ...c, learningRate: parseFloat(e.target.value) }))}
              style={{ width: "100%", accentColor: "#a78bfa" }}
            />
          </div>

          <div style={panelStyle}>
            <div style={labelStyle}>Dataset</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["xor", "circle", "spiral"].map(d => (
                <button key={d} onClick={() => setConfig(c => ({ ...c, dataset: d }))} style={{
                  ...btnBase, flex: 1, padding: "5px 6px", fontSize: 10,
                  background: config.dataset === d ? "rgba(167, 139, 250, 0.2)" : "rgba(30, 41, 59, 0.5)",
                  color: config.dataset === d ? "#a78bfa" : "#64748b",
                  border: config.dataset === d ? "1px solid rgba(167, 139, 250, 0.3)" : "1px solid rgba(148, 163, 184, 0.1)",
                }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div style={panelStyle}>
            <div style={labelStyle}>Epochs: {config.epochs}</div>
            <input type="range" min="10" max="500" step="10"
              value={config.epochs}
              onChange={e => setConfig(c => ({ ...c, epochs: parseInt(e.target.value) }))}
              style={{ width: "100%", accentColor: "#f43f5e" }}
            />
          </div>

          {/* Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button onClick={initNetwork} style={{
              ...btnBase, background: "rgba(30, 41, 59, 0.8)", color: "#94a3b8",
              border: "1px solid rgba(148, 163, 184, 0.15)",
            }}>
              ↻ Reset Network
            </button>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={stepForward} disabled={isTraining} style={{
                ...btnBase, flex: 1, background: "rgba(34, 211, 238, 0.15)", color: "#22d3ee",
                border: "1px solid rgba(34, 211, 238, 0.25)", opacity: isTraining ? 0.4 : 1,
              }}>
                → Forward
              </button>
              <button onClick={stepBackward} disabled={isTraining} style={{
                ...btnBase, flex: 1, background: "rgba(251, 146, 60, 0.15)", color: "#fb923c",
                border: "1px solid rgba(251, 146, 60, 0.25)", opacity: isTraining ? 0.4 : 1,
              }}>
                ← Backprop
              </button>
            </div>
            <button onClick={trainOneEpoch} disabled={isTraining} style={{
              ...btnBase, background: "rgba(167, 139, 250, 0.15)", color: "#a78bfa",
              border: "1px solid rgba(167, 139, 250, 0.25)", opacity: isTraining ? 0.4 : 1,
            }}>
              ▶ Train 1 Epoch
            </button>
            {!isTraining ? (
              <button onClick={trainAll} style={{
                ...btnBase, background: "linear-gradient(135deg, rgba(34,211,238,0.25), rgba(167,139,250,0.25))",
                color: "#e2e8f0", border: "1px solid rgba(167, 139, 250, 0.3)",
              }}>
                ▶▶ Train {config.epochs} Epochs
              </button>
            ) : (
              <button onClick={stopTraining} style={{
                ...btnBase, background: "rgba(244, 63, 94, 0.2)", color: "#f43f5e",
                border: "1px solid rgba(244, 63, 94, 0.3)",
              }}>
                ◼ Stop Training
              </button>
            )}
          </div>
        </div>

        {/* CENTER: Visualization */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Network Graph */}
          <div style={{ ...panelStyle, position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={labelStyle}>Network Architecture</div>
              {stepPhase && (
                <div style={{
                  fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                  background: stepPhase === "forward" ? "rgba(34,211,238,0.15)" : "rgba(251,146,60,0.15)",
                  color: stepPhase === "forward" ? "#22d3ee" : "#fb923c",
                }}>
                  {stepPhase === "forward" ? "→ FEEDFORWARD" : "← BACKPROPAGATION"}
                </div>
              )}
            </div>
            <NetworkGraph network={netRef.current} lastResult={lastResult} stepPhase={stepPhase} />
          </div>

          {/* Loss Chart */}
          <div style={panelStyle}>
            <div style={labelStyle}>Training Progress — Epoch {currentEpoch}</div>
            <LossChart history={history} />
          </div>

          {/* Epoch Log */}
          <div style={{ ...panelStyle, maxHeight: 170, overflowY: "auto" }}>
            <div style={labelStyle}>Epoch Log</div>
            <div style={{ fontSize: 9, fontFamily: FONT }}>
              <div style={{
                display: "grid", gridTemplateColumns: "50px 60px 50px 50px 55px 55px",
                gap: 4, color: "#475569", marginBottom: 4, fontWeight: 600,
              }}>
                <span>Epoch</span><span>Loss</span><span>Acc%</span><span>F1</span><span>Prec</span><span>Recall</span>
              </div>
              {epochLog.map((e, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "50px 60px 50px 50px 55px 55px",
                  gap: 4, color: "#94a3b8", padding: "1px 0",
                  borderBottom: "1px solid rgba(148,163,184,0.05)",
                }}>
                  <span style={{ color: "#64748b" }}>{e.epoch}</span>
                  <span style={{ color: "#f43f5e" }}>{e.loss}</span>
                  <span style={{ color: "#22d3ee" }}>{e.acc}%</span>
                  <span style={{ color: "#a78bfa" }}>{e.f1}</span>
                  <span>{e.prec}</span>
                  <span>{e.rec}</span>
                </div>
              ))}
              {epochLog.length === 0 && <div style={{ color: "#334155", padding: 8 }}>No epochs trained yet</div>}
            </div>
          </div>
        </div>

        {/* RIGHT: Metrics & Weights */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Metrics Cards */}
          <div style={panelStyle}>
            <div style={labelStyle}>Metrics</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {metrics ? [
                { label: "Accuracy", value: (metrics.accuracy * 100).toFixed(1) + "%", color: "#22d3ee" },
                { label: "Precision", value: (metrics.precision * 100).toFixed(1) + "%", color: "#a78bfa" },
                { label: "Recall", value: (metrics.recall * 100).toFixed(1) + "%", color: "#fb923c" },
                { label: "F1 Score", value: metrics.f1.toFixed(3), color: "#f43f5e" },
                { label: "Specificity", value: (metrics.specificity * 100).toFixed(1) + "%", color: "#34d399" },
                { label: "Loss", value: history.length > 0 ? history[history.length - 1].loss.toFixed(4) : "—", color: "#fbbf24" },
              ].map(m => (
                <div key={m.label} style={{
                  background: `${m.color}10`,
                  border: `1px solid ${m.color}20`,
                  borderRadius: 6, padding: "6px 8px",
                }}>
                  <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>{m.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
              )) : (
                <div style={{ gridColumn: "1 / -1", color: "#334155", fontSize: 10, padding: 8 }}>Train to see metrics</div>
              )}
            </div>
          </div>

          {/* Confusion Matrix */}
          <div style={panelStyle}>
            <div style={labelStyle}>Confusion Matrix</div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              {metrics ? <ConfusionMatrix metrics={metrics} /> : (
                <div style={{ color: "#334155", fontSize: 10, padding: 8 }}>Train to see matrix</div>
              )}
            </div>
          </div>

          {/* Hyperparameters */}
          <div style={panelStyle}>
            <div style={labelStyle}>Hyperparameters</div>
            <div style={{ fontSize: 10, lineHeight: 1.8 }}>
              {[
                ["Architecture", config.layers.join(" → ")],
                ["Activation", config.activation],
                ["Learning Rate", config.learningRate],
                ["Dataset", config.dataset],
                ["Total Params", network ? network.weights
                  ? network.weights.reduce((s, l) => s + l.reduce((s2, r) => s2 + r.length, 0), 0)
                    + network.biases.reduce((s, b) => s + b.length, 0)
                  : 0 : 0],
                ["Epoch", currentEpoch],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>{k}</span>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Weight Matrix */}
          <div style={{ ...panelStyle, maxHeight: 220, overflowY: "auto" }}>
            <div style={labelStyle}>Weight Matrices</div>
            {netRef.current ? <WeightMatrix network={netRef.current} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
