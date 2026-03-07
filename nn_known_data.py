"""
Neural Network Internals — Step-by-Step with Known XOR Data
============================================================
This script uses a **fixed, small dataset** (the XOR truth table) and
a **seeded** random initialisation so every run produces identical output.
Its purpose is to make every number visible: forward activations, loss,
output delta, hidden deltas, gradients, and weight updates.

Architecture : [2 → 3 → 1]
               2 inputs, 1 hidden layer of 3, 1 sigmoid output
Dataset      : All 4 XOR combinations
Seed         : 42 (fully reproducible)

Run: python nn_known_data.py
"""

import math
import random

# ─────────────────────────────────────────────────────────────────────────────
# SEED  →  every run is identical
# ─────────────────────────────────────────────────────────────────────────────
random.seed(42)

# ─────────────────────────────────────────────────────────────────────────────
# COLOUR / PRINT HELPERS
# ─────────────────────────────────────────────────────────────────────────────
CYAN   = '\033[96m'
GREEN  = '\033[92m'
YELLOW = '\033[93m'
RED    = '\033[91m'
PURPLE = '\033[95m'
BLUE   = '\033[94m'
GREY   = '\033[90m'
BOLD   = '\033[1m'
RESET  = '\033[0m'


def h1(text: str):
    bar = '═' * (len(text) + 4)
    print(f'\n{BOLD}{CYAN}╔{bar}╗')
    print(f'║  {text}  ║')
    print(f'╚{bar}╝{RESET}')


def h2(text: str):
    print(f'\n{BOLD}{YELLOW}── {text} ──{RESET}')


def h3(text: str):
    print(f'\n{PURPLE}  [{text}]{RESET}')


def row(label: str, val, color: str = RESET, indent: int = 4):
    pad = ' ' * indent
    print(f'{pad}{GREY}{label:<30}{RESET}{color}{val}{RESET}')


def divider(char: str = '─', width: int = 64, color: str = GREY):
    print(f'{color}{char * width}{RESET}')


# ─────────────────────────────────────────────────────────────────────────────
# ACTIVATION FUNCTIONS (all three from the JSX)
# ─────────────────────────────────────────────────────────────────────────────
def sigmoid(x: float) -> float:
    x = max(-500.0, min(500.0, x))
    return 1.0 / (1.0 + math.exp(-x))

def sig_d(a: float) -> float:
    """Sigmoid derivative given the *output* (post-activation) value."""
    return a * (1.0 - a)

def relu(x: float) -> float:
    return max(0.0, x)

def relu_d(a: float) -> float:
    return 1.0 if a > 0.0 else 0.0

def tanh_fn(x: float) -> float:
    return math.tanh(x)

def tanh_d(a: float) -> float:
    """Tanh derivative given the *output* (post-activation) value."""
    return 1.0 - a * a


ACTS = {
    'sigmoid': (sigmoid, sig_d),
    'relu':    (relu,    relu_d),
    'tanh':    (tanh_fn, tanh_d),
}


# ─────────────────────────────────────────────────────────────────────────────
# XOR DATASET  (all 4 exact truth-table entries — no random sampling)
# ─────────────────────────────────────────────────────────────────────────────
XOR_DATA = [
    {'input': [0.0, 0.0], 'label': 0},   # 0 XOR 0 = 0
    {'input': [0.0, 1.0], 'label': 1},   # 0 XOR 1 = 1
    {'input': [1.0, 0.0], 'label': 1},   # 1 XOR 0 = 1
    {'input': [1.0, 1.0], 'label': 0},   # 1 XOR 1 = 0
]


# ─────────────────────────────────────────────────────────────────────────────
# NEURAL NETWORK  (identical logic to nn_visualizer.py and the JSX)
# ─────────────────────────────────────────────────────────────────────────────
class NeuralNetwork:
    """
    Generic feedforward neural network with:
    - Xavier/Glorot-style weight initialisation
    - Configurable hidden-layer activation  (sigmoid / relu / tanh)
    - Sigmoid output (for binary classification)
    - Stochastic Gradient Descent with full backpropagation
    - Binary cross-entropy loss
    """

    def __init__(self, sizes: list, activation: str = 'sigmoid', lr: float = 0.5):
        self.sizes      = list(sizes)         # e.g. [2, 3, 1]
        self.activation = activation
        self.lr         = lr
        self.W: list    = []  # W[l][j][k]  → weight from neuron k in layer l
        self.B: list    = []  # B[l][j]     → bias of neuron j in layer l+1
        self._init_weights()

    def _init_weights(self):
        self.W, self.B = [], []
        for i in range(len(self.sizes) - 1):
            fi, fo = self.sizes[i], self.sizes[i + 1]
            # Xavier scale:  sqrt(2 / (fan_in + fan_out))
            scale = math.sqrt(2.0 / (fi + fo))
            self.W.append([[(random.random() * 2 - 1) * scale
                             for _ in range(fi)]
                            for _ in range(fo)])
            self.B.append([random.random() * 0.2 - 0.1 for _ in range(fo)])

    # ── Forward pass ──────────────────────────────────────────────────────────
    def forward(self, x: list) -> dict:
        """
        Returns:
          activations[l]      : post-activation values for layer l
          pre_activations[l]  : pre-activation (z) values  for layer l
        Layer 0  = input  (no activation function applied)
        Layer -1 = output (always sigmoid regardless of `self.activation`)
        """
        fn, _ = ACTS[self.activation]
        A = [list(x)]          # A[0] = input vector
        Z = [list(x)]          # Z[0] = input vector (no transform)
        cur = list(x)

        for l, (Wl, Bl) in enumerate(zip(self.W, self.B)):
            nxt, pre = [], []
            for j in range(len(Wl)):
                # z_j = b_j + Σ_k w_jk * a_k
                z = Bl[j] + sum(Wl[j][k] * cur[k] for k in range(len(cur)))
                pre.append(z)
                # Output layer always uses sigmoid
                nxt.append(sigmoid(z) if l == len(self.W) - 1 else fn(z))
            Z.append(pre)
            A.append(nxt)
            cur = nxt

        return {'activations': A, 'pre_activations': Z}

    # ── Backward pass ─────────────────────────────────────────────────────────
    def backward(self, x: list, y: int) -> dict:
        """
        Runs forward pass, computes gradients via backpropagation,
        updates W and B in-place, and returns internal state for inspection.
        """
        fwd  = self.forward(x)
        A    = fwd['activations']
        _, d = ACTS[self.activation]
        nL   = len(self.W)
        delta = [None] * nL

        # ── Output layer delta ─────────────────────────────
        # δ_j = (ŷ - y) * σ'(ŷ)
        delta[nL - 1] = [
            (A[nL][j] - y) * sig_d(A[nL][j])
            for j in range(self.sizes[-1])
        ]

        # ── Hidden layer deltas (chain rule) ───────────────
        # δ_j = Σ_k ( δ_k^{l+1} * w_kj^{l+1} ) * f'(a_j)
        for l in range(nL - 2, -1, -1):
            delta[l] = [
                sum(delta[l+1][k] * self.W[l+1][k][j]
                    for k in range(self.sizes[l + 2])) * d(A[l+1][j])
                for j in range(self.sizes[l + 1])
            ]

        # ── Gradient descent weight update ─────────────────
        # ∂L/∂w_jk = δ_j * a_k
        # w_jk  ←  w_jk  −  lr * ∂L/∂w_jk
        G = []
        for l in range(nL):
            lg = []
            for j in range(len(self.W[l])):
                ng = []
                for k in range(len(self.W[l][j])):
                    g = delta[l][j] * A[l][k]
                    ng.append(g)
                    self.W[l][j][k] -= self.lr * g
                lg.append(ng)
                self.B[l][j] -= self.lr * delta[l][j]
            G.append(lg)

        return {'activations': A, 'pre_activations': fwd['pre_activations'],
                'deltas': delta, 'gradients': G}

    def predict(self, x: list) -> float:
        return self.forward(x)['activations'][-1][0]

    def binary_cross_entropy(self, y_hat: float, y: int) -> float:
        return -(y * math.log(y_hat + 1e-10) + (1 - y) * math.log(1 - y_hat + 1e-10))

    def accuracy(self, data: list) -> float:
        correct = sum(1 for s in data
                      if (self.predict(s['input']) >= 0.5) == bool(s['label']))
        return correct / len(data)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 — PROBLEM SETUP
# ─────────────────────────────────────────────────────────────────────────────
def section_problem():
    h1('SECTION 1 — THE XOR PROBLEM')
    print(f"""
  XOR (Exclusive OR) is the classic "non-linearly separable" problem.
  No single straight line can separate the two output classes.
  That's exactly why a NN with ≥1 hidden layer is needed.

  Truth table:
    x₁  x₂  │  x₁ XOR x₂
   ─────────────────────────
     0   0   │      0       ← class 0
     0   1   │      1       ← class 1
     1   0   │      1       ← class 1
     1   1   │      0       ← class 0
""")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — NETWORK ARCHITECTURE & INITIAL WEIGHTS
# ─────────────────────────────────────────────────────────────────────────────
def section_architecture(nn: NeuralNetwork):
    h1('SECTION 2 — ARCHITECTURE & INITIAL WEIGHTS')

    sizes = nn.sizes
    print(f"""
  Topology   : {' → '.join(str(s) for s in sizes)}
  Activation : {nn.activation} (hidden layers) | sigmoid (output)
  Learning rate: {nn.lr}
  Initialisation: Xavier  scale = √(2 / (fan_in + fan_out))
""")

    for li, (Wl, Bl) in enumerate(zip(nn.W, nn.B)):
        h2(f'W  (Layer {li} → {li+1})   shape: {len(Wl)} × {len(Wl[0])}')
        for j, row_w in enumerate(Wl):
            vals = '  '.join(f'{w:+.6f}' for w in row_w)
            print(f'    neuron {j}: [{vals}]   bias: {Bl[j]:+.6f}')

    total = sum(len(r) for L in nn.W for r in L) + sum(len(b) for b in nn.B)
    print(f'\n  Total trainable parameters: {total}')


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — DETAILED FORWARD PASS
# ─────────────────────────────────────────────────────────────────────────────
def section_forward_pass(nn: NeuralNetwork):
    h1('SECTION 3 — FORWARD PASS (all 4 XOR samples)')

    for sample in XOR_DATA:
        x, y = sample['input'], sample['label']
        fwd   = nn.forward(x)
        A     = fwd['activations']
        Z     = fwd['pre_activations']
        y_hat = A[-1][0]
        loss  = nn.binary_cross_entropy(y_hat, y)

        h2(f'Input: {x}  →  Expected label: {y}')
        print(f'  Computation graph:')

        fn_name = nn.activation

        for l in range(1, len(A)):
            is_out = (l == len(A) - 1)
            act_fn = 'sigmoid' if is_out else fn_name
            print(f'\n  Layer {l}  ({act_fn}):')
            for j in range(len(A[l])):
                # Show which weights contributed
                prev_acts = A[l - 1]
                weights   = nn.W[l - 1][j]
                bias      = nn.B[l - 1][j]
                terms     = '  +  '.join(
                    f'{w:+.4f}×{prev_acts[k]:.4f}'
                    for k, w in enumerate(weights))
                z_val  = Z[l][j]
                a_val  = A[l][j]
                print(f'    h{l}_{j}: z = {bias:+.4f}  +  {terms}  =  {z_val:+.4f}'
                      f'   →   {act_fn}({z_val:+.4f}) = {a_val:.6f}')

        print(f'\n  ŷ (output) = {y_hat:.6f}')
        print(f'  Loss (BCE) = {loss:.6f}')
        predicted_class = 1 if y_hat >= 0.5 else 0
        correct = '✓' if predicted_class == y else '✗'
        print(f'  Predicted class: {predicted_class}  {correct}')
        divider()


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — DETAILED BACKWARD PASS (one sample, before any training)
# ─────────────────────────────────────────────────────────────────────────────
def section_backward_pass(nn: NeuralNetwork):
    h1('SECTION 4 — BACKWARD PASS (sample: [0, 1] → 1)')

    # Use a fresh copy of weights to not corrupt the demo network
    demo = NeuralNetwork(nn.sizes, nn.activation, nn.lr)
    demo.W = [[list(r) for r in L] for L in nn.W]
    demo.B = [list(b) for b in nn.B]

    x, y = [0.0, 1.0], 1

    print(f"""
  We pick the single sample  x=[0, 1]  y=1  and walk through
  every number produced during backpropagation.

  Notation used:
    a^l_j   = activation of neuron j in layer l
    z^l_j   = pre-activation  (weighted sum + bias)
    δ^l_j   = error signal (delta) at neuron j in layer l
    ∂L/∂w   = gradient of loss w.r.t. weight w
""")

    result = demo.backward(x, y)
    A      = result['activations']
    Z      = result['pre_activations']
    delta  = result['deltas']
    G      = result['gradients']

    # ── Forward values ─────────────────────────────────────────────────────
    h2('Step 1 — Forward Pass')
    for l in range(len(A)):
        print(f'    Layer {l}: a = [{", ".join(f"{v:.6f}" for v in A[l])}]')

    y_hat = A[-1][0]
    loss  = demo.binary_cross_entropy(y_hat, y)
    print(f'\n    ŷ = {y_hat:.6f}     BCE loss = {loss:.6f}')

    # ── Output delta ───────────────────────────────────────────────────────
    h2('Step 2 — Output Layer Delta')
    print(f"""
  Formula: δ_out = (ŷ − y) × σ'(ŷ)
  where σ'(a) = a × (1 − a)   [sigmoid derivative]

  δ_out = ({y_hat:.6f} − {y}) × ({y_hat:.6f} × (1 − {y_hat:.6f}))
        = ({y_hat - y:.6f})   × ({sig_d(y_hat):.6f})
        = {delta[-1][0]:.6f}""")

    # ── Hidden deltas ──────────────────────────────────────────────────────
    nL = len(demo.W)
    h2('Step 3 — Hidden Layer Deltas (Backpropagation)')
    fn_name = nn.activation
    _, d_fn = ACTS[fn_name]
    print(f"""
  Formula: δ^l_j = [ Σ_k (δ^{{l+1}}_k × w^{{l+1}}_kj) ] × f'(a^l_j)
  f' = {fn_name} derivative  =  f'(a)  applied to *output* activation
""")
    for l in range(nL - 2, -1, -1):
        print(f'  Layer {l + 1} (hidden):')
        for j in range(demo.sizes[l + 1]):
            weighted_sum = sum(delta[l+1][k] * demo.W[l+1][k][j]
                               for k in range(demo.sizes[l + 2]))
            act_val  = A[l+1][j]
            deriv    = d_fn(act_val)
            d_val    = delta[l][j]
            print(f'    δ_{j} = (Σ weighted deltas = {weighted_sum:+.6f})'
                  f' × {fn_name}\'({act_val:.6f}) = {deriv:.6f}'
                  f'   →   {d_val:+.6f}')

    # ── Gradients ──────────────────────────────────────────────────────────
    h2('Step 4 — Weight Gradients  ∂L/∂w_jk = δ_j × a_k')
    for l in range(nL):
        print(f'\n  Layer {l} → {l+1}:')
        for j in range(len(G[l])):
            for k in range(len(G[l][j])):
                g    = G[l][j][k]
                dj   = delta[l][j]
                ak   = A[l][k]
                print(f'    ∂L/∂w[{l}][{j}][{k}]  = δ_{j}({dj:+.6f}) × a_{k}({ak:.6f})'
                      f'  =  {g:+.6f}')

    # ── Weight update ──────────────────────────────────────────────────────
    h2('Step 5 — Weight Update  w ← w − lr × ∂L/∂w')
    print(f'  Learning rate = {demo.lr}\n')
    for l in range(nL):
        print(f'  Layer {l} → {l+1}:')
        for j in range(len(demo.W[l])):
            for k in range(len(demo.W[l][j])):
                old_w = nn.W[l][j][k]                        # before update
                grad  = G[l][j][k]
                new_w = demo.W[l][j][k]                      # after update
                change = new_w - old_w
                direction = '↓' if change < 0 else '↑'
                print(f'    w[{l}][{j}][{k}]:  {old_w:+.6f}  {direction}  '
                      f'{old_w:+.6f} − {demo.lr} × {grad:+.6f}  =  {new_w:+.6f}')
        print()


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5 — TRAINING LOOP WITH PER-EPOCH INTERNALS
# ─────────────────────────────────────────────────────────────────────────────
def section_training(nn: NeuralNetwork, epochs: int = 500):
    h1(f'SECTION 5 — TRAINING LOOP  ({epochs} epochs, all 4 XOR samples)')

    print(f"""
  Each epoch processes all 4 samples in a fixed order.
  Loss = average Binary Cross-Entropy over the 4 samples.
  Accuracy = fraction of samples classified correctly (threshold 0.5).
""")

    header = (f'{"Epoch":>6}  {"Loss":>10}  {"Accuracy":>10}  '
              f'{"[0,0]→0":>12}  {"[0,1]→1":>12}  '
              f'{"[1,0]→1":>12}  {"[1,1]→0":>12}')
    print(f'{GREY}{header}{RESET}')
    divider()

    show_epochs = set([1, 2, 3, 5, 10, 20, 50, 100, 200, 300, 400, 500,
                       epochs])

    for ep in range(1, epochs + 1):
        total_loss = 0.0
        for s in XOR_DATA:                    # fixed order (no shuffle)
            result = nn.backward(s['input'], s['label'])
            o      = result['activations'][-1][0]
            total_loss += nn.binary_cross_entropy(o, s['label'])

        loss = total_loss / len(XOR_DATA)
        acc  = nn.accuracy(XOR_DATA)
        preds = [nn.predict(s['input']) for s in XOR_DATA]

        if ep in show_epochs:
            pred_strs = [f'{p:.4f}' for p in preds]
            acc_str   = f'{acc * 100:.1f}%'
            loss_str  = f'{loss:.6f}'

            if acc >= 1.0:
                color = GREEN
            elif acc >= 0.75:
                color = YELLOW
            else:
                color = RED

            print(f'{GREY}{ep:>6}{RESET}  {color}{loss_str:>10}  {acc_str:>10}  '
                  + '  '.join(f'{p:>12}' for p in pred_strs) + RESET)

    print()
    final_acc = nn.accuracy(XOR_DATA)
    if final_acc == 1.0:
        print(f'{GREEN}  ✓  Network successfully learned XOR! '
              f'(Accuracy = 100%){RESET}')
    else:
        print(f'{YELLOW}  ⚠  Accuracy: {final_acc*100:.1f}%  '
              f'(may need more epochs or different seed){RESET}')


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 6 — FINAL INSPECTION
# ─────────────────────────────────────────────────────────────────────────────
def section_final(nn: NeuralNetwork):
    h1('SECTION 6 — FINAL WEIGHTS & PREDICTIONS')

    h2('Learned Weight Matrices')
    for li, (Wl, Bl) in enumerate(zip(nn.W, nn.B)):
        print(f'\n  Layer {li} → {li+1}:')
        for j, row_w in enumerate(Wl):
            vals = '  '.join(f'{w:+.4f}' for w in row_w)
            print(f'    neuron {j}: [{vals}]   bias: {Bl[j]:+.4f}')

    h2('Predictions on All XOR Inputs')
    print(f'\n  {"Input":^12}  {"Label":^7}  {"ŷ (raw)":^12}  {"ŷ ≥ 0.5":^10}  {"Correct?":^10}')
    divider(width=60)
    all_correct = True
    for s in XOR_DATA:
        x, y = s['input'], s['label']
        y_hat = nn.predict(x)
        pred  = 1 if y_hat >= 0.5 else 0
        ok    = pred == y
        if not ok:
            all_correct = False
        tick  = f'{GREEN}✓{RESET}' if ok else f'{RED}✗{RESET}'
        print(f'  {str(x):^12}  {y:^7}  {y_hat:^12.6f}  {pred:^10}  {tick}')

    divider(width=60)

    h2('Hidden Layer Activations (what the hidden neurons "see")')
    print("""
  After training, hidden neurons form new internal representations
  of the XOR problem — essentially intermediate features.
""")
    for s in XOR_DATA:
        x = s['input']
        A = nn.forward(x)['activations']
        hidden_str = '  '.join(f'h{j}={A[1][j]:.4f}'
                                for j in range(len(A[1])))
        print(f'  {str(x):<12} →  {hidden_str}  →  output={A[-1][0]:.4f}')


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 7 — COMPARE ACTIVATIONS
# ─────────────────────────────────────────────────────────────────────────────
def section_compare_activations():
    h1('SECTION 7 — ACTIVATION FUNCTION COMPARISON')

    print(f"""
  Each activation function shapes how neurons "fire" and how
  gradients flow backward.  Below we train three identical networks
  (same seed, same architecture, same XOR data, 500 epochs) using
  different activations and compare final accuracy and loss.
""")

    results = {}
    for act in ('sigmoid', 'relu', 'tanh'):
        random.seed(42)                          # identical init
        net = NeuralNetwork([2, 4, 4, 1], activation=act, lr=0.5)
        for _ in range(500):
            for s in XOR_DATA:
                net.backward(s['input'], s['label'])
        loss = sum(
            net.binary_cross_entropy(net.predict(s['input']), s['label'])
            for s in XOR_DATA) / len(XOR_DATA)
        acc  = net.accuracy(XOR_DATA)
        results[act] = (loss, acc)

    h2('Results after 500 epochs (seed=42, lr=0.5, arch=[2,4,4,1])')
    print(f'\n  {"Activation":^12}  {"Loss":^12}  {"Accuracy":^12}')
    divider(width=42)
    for act, (loss, acc) in results.items():
        color = GREEN if acc == 1.0 else (YELLOW if acc >= 0.75 else RED)
        print(f'  {act:^12}  {loss:^12.6f}  {color}{acc*100:^11.1f}%{RESET}')

    print(f"""
  Key properties:
  ─────────────────────────────────────────────────────────────────
  Sigmoid  • Output in (0, 1)  • Prone to vanishing gradient
             for deep networks  • Natural for output neurons
  ReLU     • Output in [0, ∞)  • Sparse activations  • Can suffer
             from "dying ReLU" (neuron always outputs 0)
  Tanh     • Output in (−1, 1) • Zero-centred  • Stronger gradient
             signal than sigmoid but still vanishes in deep nets
""")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 8 — LEARNING RATE SENSITIVITY
# ─────────────────────────────────────────────────────────────────────────────
def section_lr_sensitivity():
    h1('SECTION 8 — LEARNING RATE SENSITIVITY')

    print(f"""
  Same network (sigmoid, [2,3,1]) trained for 1 000 epochs with
  different learning rates.  Too small → slow.  Too large → diverges.
""")

    h2('Results after 1 000 epochs  (seed=42, arch=[2,3,1])')
    print(f'\n  {"LR":^8}  {"Loss":^12}  {"Accuracy":^12}  {"Status":^20}')
    divider(width=58)

    for lr in (0.01, 0.1, 0.5, 1.0, 2.0, 5.0):
        random.seed(42)
        net = NeuralNetwork([2, 3, 1], activation='sigmoid', lr=lr)
        try:
            for _ in range(1000):
                for s in XOR_DATA:
                    net.backward(s['input'], s['label'])
            loss = sum(
                net.binary_cross_entropy(net.predict(s['input']), s['label'])
                for s in XOR_DATA) / len(XOR_DATA)
            acc  = net.accuracy(XOR_DATA)
            if math.isnan(loss) or math.isinf(loss):
                raise ValueError
            color  = GREEN if acc == 1.0 else (YELLOW if acc >= 0.5 else RED)
            status = 'converged' if acc == 1.0 else ('partial' if acc >= 0.5 else 'stuck')
        except (ValueError, OverflowError):
            loss, acc, color, status = float('nan'), 0.0, RED, 'DIVERGED'
        print(f'  {lr:^8.3f}  {loss:^12.4f}  {color}{acc*100:^12.1f}%{RESET}  {color}{status:^20}{RESET}')


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    random.seed(42)   # reset before network creation

    nn = NeuralNetwork(
        sizes=[2, 3, 1],     # minimal architecture to solve XOR
        activation='sigmoid',
        lr=0.5,
    )

    section_problem()
    section_architecture(nn)
    section_forward_pass(nn)       # snapshot before any training
    section_backward_pass(nn)      # walks through ONE update step
    section_training(nn, epochs=500)
    section_final(nn)
    section_compare_activations()
    section_lr_sensitivity()

    h1('DONE')
    print("""
  To visualise the network interactively, run:

      python nn_visualizer.py

  Requirements: pip install matplotlib
""")


if __name__ == '__main__':
    main()
