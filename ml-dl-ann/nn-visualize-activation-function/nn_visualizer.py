"""
Neural Network Lab  ─  Python / Tkinter
Exact GUI equivalent of neural-network-lab.jsx

Requires: pip install matplotlib
Run:      python nn_visualizer.py
"""

import tkinter as tk
from tkinter import ttk
import math
import random
import threading
import time

try:
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

# ─────────────────────────────────────────────────────────
# COLOUR PALETTE  (mirrors React CSS vars exactly)
# ─────────────────────────────────────────────────────────
BG       = '#0b0f1a'
PANEL    = '#0f172a'
BORDER   = '#1e293b'
TEXT     = '#e2e8f0'
MUTED    = '#94a3b8'
DIM      = '#64748b'
DARKTEXT = '#475569'
CYAN     = '#22d3ee'
PURPLE   = '#a78bfa'
ORANGE   = '#fb923c'
RED      = '#f43f5e'
GREEN    = '#34d399'
YELLOW   = '#fbbf24'

MONO    = ('Courier New', 9)
MONO_SM = ('Courier New', 8)
MONO_LG = ('Courier New', 11)


def _rgb(h: str):
    h = h.lstrip('#')
    return int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16)


def _hex(r, g, b) -> str:
    return '#{:02x}{:02x}{:02x}'.format(
        int(max(0, min(255, r))),
        int(max(0, min(255, g))),
        int(max(0, min(255, b))),
    )


def blend(fg: str, alpha: float, bg: str = PANEL) -> str:
    """Mix `fg` colour into `bg` at opacity `alpha` (0–1)."""
    fr, fg2, fb = _rgb(fg)
    br, bg2, bb = _rgb(bg)
    return _hex(
        fr * alpha + br * (1 - alpha),
        fg2 * alpha + bg2 * (1 - alpha),
        fb * alpha + bb * (1 - alpha),
    )


# ─────────────────────────────────────────────────────────
# MATH UTILITIES
# ─────────────────────────────────────────────────────────
def sigmoid(x: float) -> float:
    x = max(-500.0, min(500.0, x))
    return 1.0 / (1.0 + math.exp(-x))


def sig_d(a: float) -> float:   return a * (1.0 - a)
def relu(x: float) -> float:    return max(0.0, x)
def relu_d(a: float) -> float:  return 1.0 if a > 0 else 0.0
def tanh_fn(x: float) -> float: return math.tanh(x)
def tanh_d(a: float) -> float:  return 1.0 - a * a


ACTS = {
    'sigmoid': (sigmoid, sig_d),
    'relu':    (relu,    relu_d),
    'tanh':    (tanh_fn, tanh_d),
}


# ─────────────────────────────────────────────────────────
# DATASET GENERATORS
# ─────────────────────────────────────────────────────────
def gen_xor(n: int = 200):
    out = []
    for _ in range(n):
        x1 = float(random.random() > 0.5)
        x2 = float(random.random() > 0.5)
        out.append({'input': [x1, x2], 'label': int(x1) ^ int(x2)})
    return out


def gen_circle(n: int = 200):
    out = []
    for _ in range(n):
        x = random.random() * 2 - 1
        y = random.random() * 2 - 1
        out.append({'input': [x, y], 'label': 1 if x * x + y * y < 0.5 else 0})
    return out


def gen_spiral(n: int = 200):
    out = []
    half = n // 2
    for i in range(half):
        r = i / half * 5
        t = 1.75 * i / half * 2 * math.pi + random.random() * 0.3
        out.append({'input': [r * math.cos(t) / 5,  r * math.sin(t) / 5],  'label': 0})
        out.append({'input': [-r * math.cos(t) / 5, -r * math.sin(t) / 5], 'label': 1})
    return out


DATASETS = {'xor': gen_xor, 'circle': gen_circle, 'spiral': gen_spiral}


# ─────────────────────────────────────────────────────────
# NEURAL NETWORK   (exact port of the JS class)
# ─────────────────────────────────────────────────────────
class NeuralNetwork:
    def __init__(self, sizes, activation='sigmoid', lr=0.5):
        self.sizes      = list(sizes)
        self.activation = activation
        self.lr         = lr
        self.W: list    = []   # weights[layer][j][k]
        self.B: list    = []   # biases[layer][j]
        self._init_weights()

    def _init_weights(self):
        self.W, self.B = [], []
        for i in range(len(self.sizes) - 1):
            fi, fo = self.sizes[i], self.sizes[i + 1]
            sc = math.sqrt(2.0 / (fi + fo))
            self.W.append([[(random.random() * 2 - 1) * sc for _ in range(fi)]
                            for _ in range(fo)])
            self.B.append([random.random() * 0.2 - 0.1 for _ in range(fo)])

    def forward(self, x):
        fn, _ = ACTS[self.activation]
        A, Z, cur = [list(x)], [list(x)], list(x)
        for l, (Wl, Bl) in enumerate(zip(self.W, self.B)):
            nxt, pre = [], []
            for j in range(len(Wl)):
                z = Bl[j] + sum(Wl[j][k] * cur[k] for k in range(len(cur)))
                pre.append(z)
                nxt.append(sigmoid(z) if l == len(self.W) - 1 else fn(z))
            Z.append(pre); A.append(nxt); cur = nxt
        return {'activations': A, 'pre_activations': Z}

    def backward(self, x, y):
        fwd  = self.forward(x)
        A    = fwd['activations']
        _, d = ACTS[self.activation]
        nL   = len(self.W)
        delta = [None] * nL

        # Output layer delta
        delta[nL - 1] = [
            (A[nL][j] - y) * sig_d(A[nL][j])
            for j in range(self.sizes[-1])
        ]
        # Hidden layer deltas (backprop)
        for l in range(nL - 2, -1, -1):
            delta[l] = [
                sum(delta[l+1][k] * self.W[l+1][k][j]
                    for k in range(self.sizes[l + 2])) * d(A[l+1][j])
                for j in range(self.sizes[l + 1])
            ]
        # Weight update + gradient collection
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

        return {'activations': A, 'deltas': delta, 'gradients': G}

    def train_epoch(self, data):
        loss, last = 0.0, None
        shuffled = data[:]
        random.shuffle(shuffled)
        for s in shuffled:
            last = self.backward(s['input'], s['label'])
            o    = last['activations'][-1][0]
            loss += -(s['label'] * math.log(o + 1e-10) +
                      (1 - s['label']) * math.log(1 - o + 1e-10))
        return loss / len(data), last

    def predict(self, x) -> float:
        return self.forward(x)['activations'][-1][0]

    def get_metrics(self, data) -> dict:
        tp = fp = fn = tn = 0
        for s in data:
            p, t = (1 if self.predict(s['input']) >= 0.5 else 0), s['label']
            if   p == 1 and t == 1: tp += 1
            elif p == 1 and t == 0: fp += 1
            elif p == 0 and t == 1: fn += 1
            else:                   tn += 1
        n   = tp + fp + fn + tn
        acc = (tp + tn) / n if n else 0.0
        pr  = tp / (tp + fp) if (tp + fp) else 0.0
        rc  = tp / (tp + fn) if (tp + fn) else 0.0
        f1  = 2 * pr * rc / (pr + rc) if (pr + rc) else 0.0
        sp  = tn / (tn + fp) if (tn + fp) else 0.0
        return dict(accuracy=acc, precision=pr, recall=rc, f1=f1,
                    specificity=sp, tp=tp, fp=fp, fn=fn, tn=tn)

    @property
    def total_params(self) -> int:
        return (sum(len(r) for L in self.W for r in L) +
                sum(len(b) for b in self.B))


# ─────────────────────────────────────────────────────────
# NETWORK CANVAS  (port of NetworkGraph SVG component)
# ─────────────────────────────────────────────────────────
class NetworkCanvas(tk.Canvas):
    """Draws the live neural network graph on a dark canvas."""

    PAD_X = 55
    PAD_Y = 28

    def __init__(self, parent, **kw):
        super().__init__(parent, bg=PANEL, highlightthickness=0, **kw)
        self._network = None
        self._last    = None
        self._phase   = None
        self.bind('<Configure>', lambda _: self.redraw())

    def update_state(self, network, last_result, phase):
        self._network = network
        self._last    = last_result
        self._phase   = phase
        self.redraw()

    # ── colour helpers matching JS exactly ─────────────────
    @staticmethod
    def _neuron_color(act, is_in, is_out) -> str:
        b = max(0.0, min(float(act), 1.0))
        if is_out:
            return _hex(59 + b * 140, 130 + b * 70,  246 - b * 50)
        elif is_in:
            return _hex(20 + b * 80,  184 + b * 40,  166 + b * 60)
        else:
            return _hex(100 + b * 155, 60 + b * 120, 200 + b * 55)

    # ── main draw ──────────────────────────────────────────
    def redraw(self):
        self.delete('all')
        if not self._network:
            return
        W  = self.winfo_width()
        H  = self.winfo_height()
        if W < 20 or H < 20:
            return

        nn    = self._network
        sizes = nn.sizes
        last  = self._last
        phase = self._phase
        nL    = len(sizes)
        if nL < 2:
            return

        px, py = self.PAD_X, self.PAD_Y
        sp = (W - 2 * px) / (nL - 1)

        # Compute (x, y) centre of every neuron
        pos = []
        for li, sz in enumerate(sizes):
            x     = px + li * sp
            vsp   = (H - 2 * py) / (sz + 1)
            pos.append([(x, py + vsp * (ni + 1)) for ni in range(sz)])

        acts  = last['activations'] if last else None
        grads = last.get('gradients') if last else None
        is_fwd = phase == 'forward'
        is_bwd = phase == 'backward'

        # ── Draw connections ────────────────────────────────
        for li, Wl in enumerate(nn.W):
            for j, row in enumerate(Wl):
                for k, w in enumerate(row):
                    x1, y1 = pos[li][k]
                    x2, y2 = pos[li + 1][j]
                    abs_w   = abs(w)
                    opacity = min(0.15 + abs_w * 0.6, 0.9)
                    sw      = max(1, int(min(0.5 + abs_w * 2.5, 4)))
                    fg      = CYAN if w > 0 else ORANGE
                    color   = blend(fg, opacity)

                    self.create_line(x1, y1, x2, y2,
                                     fill=color, width=sw,
                                     capstyle=tk.ROUND)

                    if is_fwd:
                        self.create_line(x1, y1, x2, y2,
                                         fill=blend(CYAN, 0.35),
                                         width=sw + 1,
                                         dash=(4, 12),
                                         capstyle=tk.ROUND)
                    elif is_bwd and grads and li < len(grads):
                        gv = 0.0
                        if j < len(grads[li]) and k < len(grads[li][j]):
                            gv = abs(grads[li][j][k])
                        if gv > 0.001:
                            bw = max(1, int(min(1 + gv * 10, 5)))
                            self.create_line(x2, y2, x1, y1,
                                             fill=blend(ORANGE, 0.45),
                                             width=bw,
                                             dash=(3, 10),
                                             capstyle=tk.ROUND)

        # ── Draw neurons ────────────────────────────────────
        for li, layer_pos in enumerate(pos):
            for ni, (x, y) in enumerate(layer_pos):
                act    = (acts[li][ni]
                          if acts and li < len(acts) and ni < len(acts[li])
                          else 0.5)
                is_in  = (li == 0)
                is_out = (li == nL - 1)
                r      = 14 if is_out else (12 if is_in else 10)
                fill   = self._neuron_color(act, is_in, is_out)

                # glow halo (simulates SVG filter="url(#glow)")
                if is_fwd or is_bwd:
                    halo = blend(fill, 0.18)
                    self.create_oval(x - r - 4, y - r - 4,
                                     x + r + 4, y + r + 4,
                                     fill=halo, outline='')

                self.create_oval(x - r, y - r, x + r, y + r,
                                 fill=fill, outline=BORDER, width=2)

                self.create_text(x, y + 1,
                                 text=f'{act:.2f}',
                                 fill='#e2e8f0',
                                 font=('Courier New', 6, 'bold'),
                                 anchor='center')

        # ── Layer labels ────────────────────────────────────
        for li, layer_pos in enumerate(pos):
            lx  = layer_pos[0][0]
            lbl = ('Input' if li == 0
                   else 'Output' if li == nL - 1
                   else f'Hidden {li}')
            self.create_text(lx, H - 5, text=lbl,
                             fill=MUTED, font=('Courier New', 8),
                             anchor='s')


# ─────────────────────────────────────────────────────────
# LOSS CHART  (port of LossChart SVG component)
# ─────────────────────────────────────────────────────────
class LossChart:
    """Embedded matplotlib chart for loss & accuracy curves."""

    def __init__(self, parent):
        self.fig = Figure(figsize=(4, 1.55), dpi=100,
                          facecolor=PANEL, tight_layout={'pad': 0.5})
        self.ax  = self.fig.add_subplot(111, facecolor=PANEL)
        self._style()

        self._canvas = FigureCanvasTkAgg(self.fig, master=parent)
        self._canvas.get_tk_widget().configure(bg=PANEL, highlightthickness=0)
        self._canvas.draw()

    def _style(self):
        ax = self.ax
        ax.tick_params(colors=DIM, labelsize=7)
        ax.set_xlabel('Epoch',  fontsize=7, color=DIM)
        ax.set_ylabel('Value',  fontsize=7, color=DIM)
        for sp in ax.spines.values():
            sp.set_edgecolor(BORDER)
        ax.grid(True, color=BORDER, linewidth=0.5, alpha=0.6)
        ax.set_facecolor(PANEL)
        ax.tick_params(colors=DIM)

    def update(self, history: list):
        self.ax.cla()
        self._style()
        if len(history) < 2:
            self.ax.text(0.5, 0.5, 'Training will show loss curve here…',
                         transform=self.ax.transAxes,
                         ha='center', va='center',
                         color=DIM, fontsize=8)
        else:
            epochs = [h['epoch']    for h in history]
            losses = [h['loss']     for h in history]
            accs   = [h['accuracy'] for h in history]
            self.ax.plot(epochs, losses, color=RED,    linewidth=1.5, label='Loss')
            self.ax.plot(epochs, accs,   color=CYAN,   linewidth=1.5,
                         linestyle='--', label='Accuracy')
            leg = self.ax.legend(fontsize=7, loc='upper right',
                                 facecolor=PANEL, edgecolor=BORDER)
            for txt in leg.get_texts():
                txt.set_color(TEXT)
        self._canvas.draw()

    def get_widget(self):
        return self._canvas.get_tk_widget()


# ─────────────────────────────────────────────────────────
# UI HELPERS
# ─────────────────────────────────────────────────────────
def make_panel(parent, **kw) -> tk.Frame:
    return tk.Frame(parent, bg=PANEL,
                    highlightthickness=1, highlightbackground=BORDER, **kw)


def section_label(parent, text: str) -> tk.Frame:
    f = tk.Frame(parent, bg=PANEL)
    tk.Label(f, text=text.upper(),
             bg=PANEL, fg=DIM,
             font=('Courier New', 8, 'bold')).pack(side='left', padx=2)
    return f


def mk_btn(parent, text, cmd, style='default', font=MONO) -> tk.Button:
    styles = {
        'reset':    (BORDER,              MUTED),
        'forward':  (blend(CYAN,   0.15), CYAN),
        'backward': (blend(ORANGE, 0.15), ORANGE),
        'epoch':    (blend(PURPLE, 0.15), PURPLE),
        'train':    (blend(CYAN,   0.12), TEXT),
        'stop':     (blend(RED,    0.20), RED),
        'default':  (BORDER,              MUTED),
    }
    bg, fg = styles.get(style, styles['default'])
    return tk.Button(parent, text=text, command=cmd,
                     bg=bg, fg=fg, font=font,
                     activebackground=blend(fg, 0.30),
                     activeforeground=fg,
                     relief='flat', bd=0, padx=10, pady=6,
                     cursor='hand2')


# ─────────────────────────────────────────────────────────
# MAIN APPLICATION  (port of NeuralNetworkLab React component)
# ─────────────────────────────────────────────────────────
class App:
    # ── Initialise ────────────────────────────────────────
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title('Neural Network Lab')
        root.configure(bg=BG)
        root.geometry('1340x860')
        root.minsize(900, 640)

        # App state (mirrors React useState)
        self.layers       = [2, 4, 4, 1]
        self.activation   = 'sigmoid'
        self.lr           = 0.5
        self.dataset_key  = 'xor'
        self.epochs       = 100

        self.network       = None
        self.history: list = []
        self.metrics_data  = None
        self.last_result   = None
        self.step_phase    = None
        self.is_training   = False
        self._stop_flag    = threading.Event()
        self.current_epoch = 0
        self.epoch_log: list = []

        # Tk variables
        self._layer_str = tk.StringVar(value='2, 4, 4, 1')
        self._lr_var    = tk.DoubleVar(value=0.5)
        self._epoch_var = tk.IntVar(value=100)
        self._lr_lbl    = tk.StringVar(value='Learning Rate: 0.50')
        self._ep_lbl    = tk.StringVar(value='Epochs: 100')

        self._build_header()
        self._build_main()
        self.init_network()

    # ─────────────────────────────────────────────────────
    # BUILD HEADER
    # ─────────────────────────────────────────────────────
    def _build_header(self):
        hf = tk.Frame(self.root, bg=BG)
        hf.pack(fill='x', padx=16, pady=(12, 6))
        tk.Label(hf,
                 text='Neural Network Lab',
                 bg=BG, fg=CYAN,
                 font=('Arial', 22, 'bold')).pack()
        tk.Label(hf,
                 text='Interactive feedforward & backpropagation visualizer',
                 bg=BG, fg=DARKTEXT,
                 font=('Arial', 10)).pack()

    # ─────────────────────────────────────────────────────
    # BUILD MAIN  (3-column grid)
    # ─────────────────────────────────────────────────────
    def _build_main(self):
        mf = tk.Frame(self.root, bg=BG)
        mf.pack(fill='both', expand=True, padx=14, pady=(0, 14))
        mf.grid_columnconfigure(1, weight=1)
        mf.grid_rowconfigure(0, weight=1)
        self._build_left(mf)
        self._build_center(mf)
        self._build_right(mf)

    # ─────────────────────────────────────────────────────
    # LEFT COLUMN  (config + controls)
    # ─────────────────────────────────────────────────────
    def _build_left(self, parent):
        lf = tk.Frame(parent, bg=BG, width=244)
        lf.grid(row=0, column=0, sticky='ns', padx=(0, 10))
        lf.grid_propagate(False)

        # --- Architecture ---
        p = make_panel(lf); p.pack(fill='x', pady=(0, 8))
        section_label(p, 'Architecture').pack(fill='x', padx=8, pady=(7, 2))
        ent = tk.Entry(p, textvariable=self._layer_str,
                       bg='#1e293b', fg=TEXT, insertbackground=TEXT,
                       relief='flat', font=MONO,
                       highlightthickness=1,
                       highlightcolor=CYAN, highlightbackground=BORDER)
        ent.pack(fill='x', padx=8, pady=(0, 2))
        ent.bind('<FocusOut>', lambda _: self._on_layer_change())
        ent.bind('<Return>',   lambda _: self._on_layer_change())
        tk.Label(p, text='Must start with 2, end with 1',
                 bg=PANEL, fg=DARKTEXT,
                 font=('Courier New', 8)).pack(anchor='w', padx=8, pady=(0, 6))

        # --- Activation ---
        p = make_panel(lf); p.pack(fill='x', pady=(0, 8))
        section_label(p, 'Activation').pack(fill='x', padx=8, pady=(7, 4))
        self._act_btns: dict = {}
        bf = tk.Frame(p, bg=PANEL); bf.pack(fill='x', padx=8, pady=(0, 8))
        for act in ('sigmoid', 'relu', 'tanh'):
            b = tk.Button(bf, text=act, font=MONO, relief='flat',
                          cursor='hand2',
                          command=lambda a=act: self._set_activation(a))
            b.pack(side='left', expand=True, fill='x', padx=2)
            self._act_btns[act] = b
        self._refresh_act_btns()

        # --- Learning Rate ---
        p = make_panel(lf); p.pack(fill='x', pady=(0, 8))
        tk.Label(p, textvariable=self._lr_lbl,
                 bg=PANEL, fg=DIM,
                 font=('Courier New', 8, 'bold')).pack(anchor='w', padx=8, pady=(7, 2))
        tk.Scale(p, from_=0.01, to=2.0, resolution=0.01,
                 orient='horizontal', variable=self._lr_var,
                 bg=PANEL, fg=MUTED, troughcolor=BORDER,
                 activebackground=PURPLE, sliderrelief='flat',
                 highlightthickness=0, showvalue=False,
                 command=self._on_lr_change).pack(fill='x', padx=8, pady=(0, 8))

        # --- Dataset ---
        p = make_panel(lf); p.pack(fill='x', pady=(0, 8))
        section_label(p, 'Dataset').pack(fill='x', padx=8, pady=(7, 4))
        self._ds_btns: dict = {}
        bf = tk.Frame(p, bg=PANEL); bf.pack(fill='x', padx=8, pady=(0, 8))
        for ds in ('xor', 'circle', 'spiral'):
            b = tk.Button(bf, text=ds, font=MONO, relief='flat',
                          cursor='hand2',
                          command=lambda d=ds: self._set_dataset(d))
            b.pack(side='left', expand=True, fill='x', padx=2)
            self._ds_btns[ds] = b
        self._refresh_ds_btns()

        # --- Epochs ---
        p = make_panel(lf); p.pack(fill='x', pady=(0, 8))
        tk.Label(p, textvariable=self._ep_lbl,
                 bg=PANEL, fg=DIM,
                 font=('Courier New', 8, 'bold')).pack(anchor='w', padx=8, pady=(7, 2))
        tk.Scale(p, from_=10, to=500, resolution=10,
                 orient='horizontal', variable=self._epoch_var,
                 bg=PANEL, fg=MUTED, troughcolor=BORDER,
                 activebackground=RED, sliderrelief='flat',
                 highlightthickness=0, showvalue=False,
                 command=self._on_epoch_change).pack(fill='x', padx=8, pady=(0, 8))

        # --- Controls ---
        cf = tk.Frame(lf, bg=BG); cf.pack(fill='x')
        mk_btn(cf, '↻  Reset Network', self.init_network, 'reset').pack(fill='x', pady=(0, 4))

        row = tk.Frame(cf, bg=BG); row.pack(fill='x', pady=(0, 4))
        mk_btn(row, '→  Forward',  self.step_forward,  'forward').pack(
            side='left', fill='x', expand=True, padx=(0, 3))
        mk_btn(row, '←  Backprop', self.step_backward, 'backward').pack(
            side='left', fill='x', expand=True)

        mk_btn(cf, '▶  Train 1 Epoch', self.train_one_epoch, 'epoch').pack(
            fill='x', pady=(0, 4))

        self._train_all_btn = tk.Button(
            cf, font=MONO, cursor='hand2', relief='flat', bd=0, pady=6,
            command=self._toggle_training)
        self._train_all_btn.pack(fill='x')
        self._refresh_train_btn()

    # ─────────────────────────────────────────────────────
    # CENTER COLUMN
    # ─────────────────────────────────────────────────────
    def _build_center(self, parent):
        cf = tk.Frame(parent, bg=BG)
        cf.grid(row=0, column=1, sticky='nsew')
        cf.grid_rowconfigure(0, weight=4)
        cf.grid_rowconfigure(1, weight=3)
        cf.grid_rowconfigure(2, weight=2)
        cf.grid_columnconfigure(0, weight=1)

        # --- Network graph ---
        ng = make_panel(cf)
        ng.grid(row=0, column=0, sticky='nsew', pady=(0, 8))
        ng.grid_rowconfigure(1, weight=1)
        ng.grid_columnconfigure(0, weight=1)

        top = tk.Frame(ng, bg=PANEL)
        top.grid(row=0, column=0, sticky='ew', padx=8, pady=(6, 2))
        tk.Label(top, text='NETWORK ARCHITECTURE',
                 bg=PANEL, fg=DIM,
                 font=('Courier New', 8, 'bold')).pack(side='left')
        self._phase_lbl = tk.Label(top, text='',
                                   bg=PANEL, font=('Courier New', 8, 'bold'))
        self._phase_lbl.pack(side='right', padx=4)

        self._net_canvas = NetworkCanvas(ng, height=230)
        self._net_canvas.grid(row=1, column=0, sticky='nsew', padx=6, pady=(0, 6))

        # --- Loss chart ---
        lc = make_panel(cf)
        lc.grid(row=1, column=0, sticky='nsew', pady=(0, 8))
        lc.grid_rowconfigure(1, weight=1)
        lc.grid_columnconfigure(0, weight=1)

        self._ep_hdr = tk.Label(lc, text='TRAINING PROGRESS — Epoch 0',
                                bg=PANEL, fg=DIM,
                                font=('Courier New', 8, 'bold'))
        self._ep_hdr.grid(row=0, column=0, sticky='w', padx=8, pady=(6, 2))

        if HAS_MPL:
            self._loss_chart = LossChart(lc)
            self._loss_chart.get_widget().grid(
                row=1, column=0, sticky='nsew', padx=6, pady=(0, 6))
        else:
            tk.Label(lc, text='Install matplotlib for the loss chart.',
                     bg=PANEL, fg=DIM, font=MONO).grid(row=1, column=0)
            self._loss_chart = None

        # --- Epoch log ---
        el = make_panel(cf)
        el.grid(row=2, column=0, sticky='nsew')
        el.grid_rowconfigure(1, weight=1)
        el.grid_columnconfigure(0, weight=1)

        tk.Label(el, text='EPOCH LOG',
                 bg=PANEL, fg=DIM,
                 font=('Courier New', 8, 'bold')).grid(
            row=0, column=0, sticky='w', padx=8, pady=(6, 2))

        log_fr = tk.Frame(el, bg=PANEL)
        log_fr.grid(row=1, column=0, sticky='nsew', padx=6, pady=(0, 6))
        log_fr.grid_columnconfigure(0, weight=1)
        log_fr.grid_rowconfigure(0, weight=1)

        self._log = tk.Text(log_fr, bg='#0d1829', fg=MUTED,
                            font=('Courier New', 8), state='disabled',
                            relief='flat', wrap='none', height=5,
                            selectbackground=BORDER)
        self._log.grid(row=0, column=0, sticky='nsew')

        sb = tk.Scrollbar(log_fr, orient='vertical',
                          command=self._log.yview, bg=BORDER)
        sb.grid(row=0, column=1, sticky='ns')
        self._log.configure(yscrollcommand=sb.set)

        for tag, fg in (('epoch', DIM), ('loss', RED), ('acc', CYAN),
                        ('f1', PURPLE), ('hdr', DARKTEXT)):
            self._log.tag_configure(tag, foreground=fg)

    # ─────────────────────────────────────────────────────
    # RIGHT COLUMN
    # ─────────────────────────────────────────────────────
    def _build_right(self, parent):
        rf = tk.Frame(parent, bg=BG, width=222)
        rf.grid(row=0, column=2, sticky='ns', padx=(10, 0))
        rf.grid_propagate(False)

        # --- Metrics grid ---
        mp = make_panel(rf); mp.pack(fill='x', pady=(0, 8))
        section_label(mp, 'Metrics').pack(fill='x', padx=8, pady=(7, 4))
        mf = tk.Frame(mp, bg=PANEL); mf.pack(fill='x', padx=8, pady=(0, 8))
        self._m_lbls: dict = {}
        cfg = [
            ('Accuracy',    CYAN,   0, 0),
            ('Precision',   PURPLE, 0, 1),
            ('Recall',      ORANGE, 1, 0),
            ('F1 Score',    RED,    1, 1),
            ('Specificity', GREEN,  2, 0),
            ('Loss',        YELLOW, 2, 1),
        ]
        for name, color, row, col in cfg:
            cell = tk.Frame(mf, bg=blend(color, 0.07),
                            highlightthickness=1,
                            highlightbackground=blend(color, 0.15))
            cell.grid(row=row, column=col, padx=2, pady=2, sticky='nsew')
            mf.grid_columnconfigure(col, weight=1)
            tk.Label(cell, text=name.upper(),
                     bg=blend(color, 0.07), fg=DIM,
                     font=('Courier New', 7)).pack(anchor='w', padx=4, pady=(3, 0))
            v = tk.Label(cell, text='—',
                         bg=blend(color, 0.07), fg=color,
                         font=('Courier New', 14, 'bold'))
            v.pack(anchor='w', padx=4, pady=(0, 3))
            self._m_lbls[name] = v

        # --- Confusion matrix ---
        cp = make_panel(rf); cp.pack(fill='x', pady=(0, 8))
        section_label(cp, 'Confusion Matrix').pack(fill='x', padx=8, pady=(7, 4))
        cf2 = tk.Frame(cp, bg=PANEL); cf2.pack(padx=8, pady=(0, 8))
        self._conf_lbls: dict = {}
        for i, (lbl, color) in enumerate(
                [('TP', CYAN), ('FP', ORANGE), ('FN', ORANGE), ('TN', CYAN)]):
            r, c = divmod(i, 2)
            cell = tk.Frame(cf2, bg=blend(color, 0.07),
                            highlightthickness=1,
                            highlightbackground=blend(color, 0.15),
                            width=62, height=50)
            cell.grid(row=r, column=c, padx=2, pady=2)
            cell.grid_propagate(False)
            tk.Label(cell, text=lbl,
                     bg=blend(color, 0.07), fg=MUTED,
                     font=('Courier New', 7)).place(relx=0.5, rely=0.3, anchor='center')
            v = tk.Label(cell, text='—',
                         bg=blend(color, 0.07), fg=color,
                         font=('Courier New', 13, 'bold'))
            v.place(relx=0.5, rely=0.68, anchor='center')
            self._conf_lbls[lbl] = v

        # --- Hyperparameters ---
        hp = make_panel(rf); hp.pack(fill='x', pady=(0, 8))
        section_label(hp, 'Hyperparameters').pack(fill='x', padx=8, pady=(7, 2))
        hf2 = tk.Frame(hp, bg=PANEL); hf2.pack(fill='x', padx=8, pady=(0, 8))
        self._hp_lbls: dict = {}
        for name in ('Architecture', 'Activation', 'Learning Rate',
                     'Dataset', 'Total Params', 'Epoch'):
            row_f = tk.Frame(hf2, bg=PANEL); row_f.pack(fill='x', pady=1)
            tk.Label(row_f, text=name, bg=PANEL, fg=DIM,
                     font=('Courier New', 8)).pack(side='left')
            v = tk.Label(row_f, text='—', bg=PANEL, fg=MUTED,
                         font=('Courier New', 8, 'bold'))
            v.pack(side='right')
            self._hp_lbls[name] = v

        # --- Weight matrices ---
        wp = make_panel(rf); wp.pack(fill='both', expand=True)
        section_label(wp, 'Weight Matrices').pack(fill='x', padx=8, pady=(7, 2))

        wf = tk.Frame(wp, bg=PANEL); wf.pack(fill='both', expand=True, padx=8, pady=(0, 8))
        self._wm_canvas = tk.Canvas(wf, bg=PANEL, highlightthickness=0)
        wm_sb = tk.Scrollbar(wf, orient='vertical',
                             command=self._wm_canvas.yview, bg=BORDER)
        self._wm_inner = tk.Frame(self._wm_canvas, bg=PANEL)

        self._wm_canvas.configure(yscrollcommand=wm_sb.set)
        self._wm_canvas.pack(side='left', fill='both', expand=True)
        wm_sb.pack(side='right', fill='y')

        self._wm_win = self._wm_canvas.create_window(
            (0, 0), window=self._wm_inner, anchor='nw')
        self._wm_inner.bind(
            '<Configure>',
            lambda _: self._wm_canvas.configure(
                scrollregion=self._wm_canvas.bbox('all')))
        self._wm_canvas.bind(
            '<Configure>',
            lambda e: self._wm_canvas.itemconfig(self._wm_win, width=e.width))

    # ─────────────────────────────────────────────────────
    # ACTIONS
    # ─────────────────────────────────────────────────────
    def init_network(self):
        self.network       = NeuralNetwork(self.layers, self.activation, self.lr)
        self.history       = []
        self.metrics_data  = None
        self.last_result   = None
        self.step_phase    = None
        self.current_epoch = 0
        self.epoch_log     = []
        self._refresh_all()

    def _get_data(self):
        return DATASETS[self.dataset_key](200)

    def step_forward(self):
        if not self.network or self.is_training:
            return
        sample = random.choice(self._get_data())
        result = self.network.forward(sample['input'])
        self.last_result = {'activations': result['activations']}
        self.step_phase  = 'forward'
        self._refresh_all()

    def step_backward(self):
        if not self.network or self.is_training:
            return
        data   = self._get_data()
        sample = random.choice(data)
        self.last_result  = self.network.backward(sample['input'], sample['label'])
        self.step_phase   = 'backward'
        self.metrics_data = self.network.get_metrics(data)
        self._refresh_all()

    def train_one_epoch(self):
        if not self.network or self.is_training:
            return
        data = self._get_data()
        loss, lr = self.network.train_epoch(data)
        m = self.network.get_metrics(data)
        self.current_epoch += 1
        ep = self.current_epoch
        self.history.append({'epoch': ep, 'loss': loss, 'accuracy': m['accuracy']})
        self.metrics_data = m
        self.last_result  = lr
        self.step_phase   = 'forward'
        self.epoch_log.append({
            'epoch': ep, 'loss': f'{loss:.4f}',
            'acc':  f'{m["accuracy"]*100:.1f}',
            'f1':   f'{m["f1"]:.3f}',
            'prec': f'{m["precision"]:.3f}',
            'rec':  f'{m["recall"]:.3f}',
        })
        self._refresh_all()

    def _toggle_training(self):
        if self.is_training:
            self._stop_flag.set()
        else:
            self._start_training()

    def _start_training(self):
        self._stop_flag.clear()
        self.is_training = True
        self._refresh_train_btn()
        threading.Thread(target=self._train_loop, daemon=True).start()

    def _train_loop(self):
        data   = self._get_data()
        target = self.epochs
        for e in range(target):
            if self._stop_flag.is_set():
                break
            loss, lr_ = self.network.train_epoch(data)
            m = self.network.get_metrics(data)
            self.current_epoch += 1
            ep = self.current_epoch
            self.history.append({'epoch': ep, 'loss': loss, 'accuracy': m['accuracy']})
            self.metrics_data = m
            self.last_result  = lr_
            self.step_phase   = 'forward' if e % 2 == 0 else 'backward'
            if e % 5 == 0 or e == target - 1:
                self.epoch_log.append({
                    'epoch': ep, 'loss': f'{loss:.4f}',
                    'acc':  f'{m["accuracy"]*100:.1f}',
                    'f1':   f'{m["f1"]:.3f}',
                    'prec': f'{m["precision"]:.3f}',
                    'rec':  f'{m["recall"]:.3f}',
                })
            self.root.after(0, self._refresh_all)
            time.sleep(0.03)
        self.is_training = False
        self.root.after(0, self._refresh_train_btn)

    # ─────────────────────────────────────────────────────
    # UI REFRESH
    # ─────────────────────────────────────────────────────
    def _refresh_all(self):
        self._net_canvas.update_state(self.network, self.last_result, self.step_phase)
        self._update_phase_label()
        self._ep_hdr.configure(text=f'TRAINING PROGRESS — Epoch {self.current_epoch}')
        if HAS_MPL and self._loss_chart:
            self._loss_chart.update(self.history)
        self._update_epoch_log()
        self._update_metrics()
        self._update_confusion()
        self._update_hyperparams()
        self._update_weights()

    def _update_phase_label(self):
        if self.step_phase == 'forward':
            self._phase_lbl.configure(text='→ FEEDFORWARD',    fg=CYAN,   bg=PANEL)
        elif self.step_phase == 'backward':
            self._phase_lbl.configure(text='← BACKPROPAGATION', fg=ORANGE, bg=PANEL)
        else:
            self._phase_lbl.configure(text='', bg=PANEL)

    def _update_epoch_log(self):
        t = self._log
        t.configure(state='normal')
        t.delete('1.0', 'end')
        if not self.epoch_log:
            t.insert('end', '  No epochs trained yet\n', 'hdr')
        else:
            t.insert('end',
                     f'{"Epoch":>6}  {"Loss":>8}  {"Acc%":>6}  '
                     f'{"F1":>6}  {"Prec":>6}  {"Recall":>6}\n', 'hdr')
            t.insert('end', '─' * 55 + '\n', 'hdr')
            for e in self.epoch_log[-20:]:
                t.insert('end', f'{e["epoch"]:>6}', 'epoch')
                t.insert('end', f'  {e["loss"]:>8}',      'loss')
                t.insert('end', f'  {e["acc"]:>5}%',       'acc')
                t.insert('end', f'  {e["f1"]:>6}',        'f1')
                t.insert('end', f'  {e["prec"]:>6}  {e["rec"]:>6}\n')
        t.configure(state='disabled')
        t.see('end')

    def _update_metrics(self):
        m = self.metrics_data
        if not m:
            return
        vals = {
            'Accuracy':    f'{m["accuracy"]*100:.1f}%',
            'Precision':   f'{m["precision"]*100:.1f}%',
            'Recall':      f'{m["recall"]*100:.1f}%',
            'F1 Score':    f'{m["f1"]:.3f}',
            'Specificity': f'{m["specificity"]*100:.1f}%',
            'Loss':        (f'{self.history[-1]["loss"]:.4f}'
                            if self.history else '—'),
        }
        for k, lbl in self._m_lbls.items():
            lbl.configure(text=vals.get(k, '—'))

    def _update_confusion(self):
        m = self.metrics_data
        if not m:
            return
        for k in ('TP', 'FP', 'FN', 'TN'):
            self._conf_lbls[k].configure(text=str(m[k.lower()]))

    def _update_hyperparams(self):
        if not self.network:
            return
        vals = {
            'Architecture': ' → '.join(str(s) for s in self.layers),
            'Activation':   self.activation,
            'Learning Rate': f'{self.lr:.2f}',
            'Dataset':      self.dataset_key,
            'Total Params': str(self.network.total_params),
            'Epoch':        str(self.current_epoch),
        }
        for k, lbl in self._hp_lbls.items():
            lbl.configure(text=vals.get(k, '—'))

    def _update_weights(self):
        if not self.network:
            return
        for w in self._wm_inner.winfo_children():
            w.destroy()
        for li, layer in enumerate(self.network.W):
            tk.Label(self._wm_inner,
                     text=f'Layer {li} → {li+1} weights',
                     bg=PANEL, fg=DIM,
                     font=('Courier New', 8)).pack(anchor='w', pady=(4, 2))
            grid = tk.Frame(self._wm_inner, bg=PANEL)
            grid.pack(fill='x')
            for j, row in enumerate(layer):
                for k, w in enumerate(row):
                    abs_w = min(abs(w), 2.0)
                    intensity = abs_w / 2.0
                    bg_c = (blend(CYAN,   0.10 + intensity * 0.50) if w >= 0
                            else blend(ORANGE, 0.10 + intensity * 0.50))
                    tk.Label(grid,
                             text=f'{w:+.3f}',
                             bg=bg_c, fg=TEXT,
                             font=('Courier New', 7),
                             relief='flat', padx=3, pady=2,
                             highlightthickness=1,
                             highlightbackground=blend(MUTED, 0.08)).grid(
                        row=j, column=k, padx=1, pady=1, sticky='nsew')
                    grid.grid_columnconfigure(k, weight=1)

    # ─────────────────────────────────────────────────────
    # CONFIG HANDLERS
    # ─────────────────────────────────────────────────────
    def _on_layer_change(self):
        parts = []
        for s in self._layer_str.get().split(','):
            try:
                n = int(s.strip())
                if 1 <= n <= 8:
                    parts.append(n)
            except ValueError:
                pass
        if len(parts) >= 2 and parts[0] == 2 and parts[-1] == 1:
            self.layers = parts

    def _set_activation(self, act: str):
        self.activation = act
        self._refresh_act_btns()

    def _on_lr_change(self, val):
        self.lr = round(float(val), 2)
        self._lr_lbl.set(f'Learning Rate: {self.lr:.2f}')

    def _set_dataset(self, ds: str):
        self.dataset_key = ds
        self._refresh_ds_btns()

    def _on_epoch_change(self, val):
        self.epochs = int(float(val))
        self._ep_lbl.set(f'Epochs: {self.epochs}')
        if not self.is_training:
            self._refresh_train_btn()

    # ─────────────────────────────────────────────────────
    # BUTTON STYLE REFRESH
    # ─────────────────────────────────────────────────────
    def _refresh_act_btns(self):
        for act, btn in self._act_btns.items():
            if act == self.activation:
                btn.configure(bg=blend(CYAN, 0.20), fg=CYAN,
                              activebackground=blend(CYAN, 0.30))
            else:
                btn.configure(bg=BORDER, fg=DIM,
                              activebackground=BORDER)

    def _refresh_ds_btns(self):
        for ds, btn in self._ds_btns.items():
            if ds == self.dataset_key:
                btn.configure(bg=blend(PURPLE, 0.20), fg=PURPLE,
                              activebackground=blend(PURPLE, 0.30))
            else:
                btn.configure(bg=BORDER, fg=DIM,
                              activebackground=BORDER)

    def _refresh_train_btn(self):
        if self.is_training:
            self._train_all_btn.configure(
                text='◼  Stop Training',
                bg=blend(RED, 0.20), fg=RED,
                activebackground=blend(RED, 0.35),
                activeforeground=RED)
        else:
            self._train_all_btn.configure(
                text=f'▶▶  Train {self.epochs} Epochs',
                bg=blend(CYAN, 0.12), fg=TEXT,
                activebackground=blend(PURPLE, 0.30),
                activeforeground=TEXT)


# ─────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────
def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == '__main__':
    main()
