import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Arc
from sklearn.metrics.pairwise import cosine_similarity

def generate_vectors(n, dim=2, seed=None):
    rng = np.random.default_rng(seed)
    vectors = rng.normal(size=(n, dim))
    return vectors

def angle_degrees(u, v):
    norm_product = np.linalg.norm(u) * np.linalg.norm(v)
    if norm_product == 0:
        return np.nan

    cosine = np.dot(u, v) / norm_product
    return cosine_to_angles(cosine)

def cosine_to_angles(cosines):
    clipped = np.clip(cosines, -1, 1)
    angles = np.degrees(np.arccos(clipped))
    return np.where(np.isclose(clipped, 1), 0, np.where(np.isclose(clipped, -1), 180, angles))

def plot_angle_indicator_2d(vectors, ax, pair=(0, 1), origin=(0, 0), color="crimson"):
    i, j = pair
    if i >= len(vectors) or j >= len(vectors):
        return

    first = vectors[i]
    second = vectors[j]
    if np.linalg.norm(first) == 0 or np.linalg.norm(second) == 0:
        return

    x0, y0 = origin
    first_angle = np.degrees(np.arctan2(first[1], first[0])) % 360
    second_angle = np.degrees(np.arctan2(second[1], second[0])) % 360
    sweep = (second_angle - first_angle) % 360
    if sweep > 180:
        first_angle, second_angle = second_angle, first_angle
        sweep = 360 - sweep

    radius = max(0.25, min(np.linalg.norm(first), np.linalg.norm(second)) * 0.35)
    arc = Arc(
        origin,
        width=2 * radius,
        height=2 * radius,
        angle=0,
        theta1=first_angle,
        theta2=first_angle + sweep,
        color=color,
        linewidth=1.6,
    )
    ax.add_patch(arc)

    theta = angle_degrees(first, second)
    label_angle = np.radians(first_angle + sweep / 2)
    label_radius = radius * 1.25
    ax.text(
        x0 + label_radius * np.cos(label_angle),
        y0 + label_radius * np.sin(label_angle),
        f"θ={theta:.1f}°",
        color=color,
        fontsize=9,
        ha="center",
        va="center",
    )

def plot_vectors_2d(vectors, ax=None, origin=(0, 0), colors=None, angle_pair=(0, 1)):
    if vectors.shape[1] != 2:
        raise ValueError("plot_vectors_2d requires 2D vectors (shape: n x 2).")

    if ax is None:
        fig, ax = plt.subplots()

    n = vectors.shape[0]
    x0, y0 = origin

    X = np.full(n, x0)
    Y = np.full(n, y0)
    U = vectors[:, 0]
    V = vectors[:, 1]

    if colors is None:
        colors = np.arange(n)

    ax.quiver(X, Y, U, V, angles='xy', scale_units='xy', scale=1, color=plt.cm.tab10(colors % 10))
    for i, (u, v) in enumerate(zip(U, V)):
        ax.text(u * 1.05, v * 1.05, f"v{i}", fontsize=9)

    if angle_pair is not None:
        plot_angle_indicator_2d(vectors, ax, pair=angle_pair, origin=origin)

    ax.set_xlabel("x")
    ax.set_ylabel("y")
    ax.set_title("2D Vectors")
    ax.axhline(0, color="grey", linewidth=0.5)
    ax.axvline(0, color="grey", linewidth=0.5)
    ax.set_aspect("equal", "box")

    all_x = np.concatenate([X, X + U])
    all_y = np.concatenate([Y, Y + V])
    margin = 0.2
    ax.set_xlim(all_x.min() - margin, all_x.max() + margin)
    ax.set_ylim(all_y.min() - margin, all_y.max() + margin)

    return ax

def plot_cosine_similarity_matrix(sim_matrix, ax=None, angle_matrix=None):
    """
    Visualize cosine similarity matrix as a heatmap.
    """
    if ax is None:
        fig, ax = plt.subplots()

    im = ax.imshow(sim_matrix, cmap="Blues", vmin=-1, vmax=1)
    ax.set_title("Cosine Similarity / Angle Matrix")
    ax.set_xlabel("Vector index")
    ax.set_ylabel("Vector index")

    n = sim_matrix.shape[0]
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))

    for i in range(n):
        for j in range(n):
            label = f"{sim_matrix[i, j]:.2f}"
            if angle_matrix is not None:
                label += f"\nθ={angle_matrix[i, j]:.0f}°"
            ax.text(j, i, label,
                    ha="center", va="center", color="white" if abs(sim_matrix[i, j]) > 0.5 else "black",
                    fontsize=7)

    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    return ax

def main(n=5, dim=2, seed=42):
    vectors = generate_vectors(n=n, dim=dim, seed=seed)
    vectors = np.array([
        [2, 5],
        [1, 4],
        [4, 1],
        [1, 5],
        [3, 3],
        [3, 4]
    ], dtype=float)

    n, dim = vectors.shape

    if dim == 2:
        fig, (ax_vec, ax_sim) = plt.subplots(1, 2, figsize=(10, 4))
    else:
        fig, ax_sim = plt.subplots(1, 1, figsize=(5, 4))
        ax_vec = None

    if dim == 2:
        plot_vectors_2d(vectors, ax=ax_vec)

    matrix = vectors  # for clarity
    print("Matrix of vectors (shape: n x dim):")
    print(matrix)

    cos_sim = cosine_similarity(matrix)
    print("\nCosine similarity matrix:")
    print(cos_sim)

    angle_matrix = cosine_to_angles(cos_sim)
    print("\nAngle matrix in degrees:")
    print(angle_matrix)

    plot_cosine_similarity_matrix(cos_sim, ax=ax_sim, angle_matrix=angle_matrix)

    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    main(n=6, dim=2, seed=124)
