import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics.pairwise import cosine_similarity


def generate_vectors(n, dim=2, seed=None):
    """
    Generate n random vectors of given dimension.
    For 2D visualization, dim should be 2.
    """
    rng = np.random.default_rng(seed)
    vectors = rng.normal(size=(n, dim))
    return vectors


def plot_vectors_2d(vectors, ax=None, origin=(0, 0), colors=None):
    """
    Plot 2D vectors from a common origin using quiver.
    """
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

    ax.quiver(
        X, Y, U, V,
        angles='xy',
        scale_units='xy',
        scale=1,
        color=plt.cm.tab10(colors % 10)
    )

    for i, (u, v) in enumerate(zip(U, V)):
        ax.text(u * 1.05, v * 1.05, f"v{i}", fontsize=9)

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


def plot_heatmap(matrix, ax=None, title="Heatmap", cmap="Blues", vmin=None, vmax=None,
                 annotate=True, fmt="{:.2f}"):
    """
    Generic heatmap helper using imshow.
    """
    if ax is None:
        fig, ax = plt.subplots()

    im = ax.imshow(matrix, cmap=cmap, vmin=vmin, vmax=vmax)
    ax.set_title(title)
    ax.set_xlabel("Vector index")
    ax.set_ylabel("Vector index")

    n = matrix.shape[0]
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))

    if annotate:
        for i in range(n):
            for j in range(n):
                val = matrix[i, j]
                ax.text(
                    j, i, fmt.format(val),
                    ha="center", va="center",
                    color="white" if (vmin is not None and vmax is not None and abs(val - (vmin + vmax) / 2) > (vmax - vmin) / 4) else "black",
                    fontsize=7
                )

    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    return ax


def plot_cosine_similarity_matrix(sim_matrix, ax=None):
    """
    Visualize cosine similarity matrix as a heatmap.
    """
    return plot_heatmap(
        sim_matrix, ax=ax,
        title="Cosine Similarity Matrix",
        cmap="Blues",
        vmin=-1, vmax=1,
        annotate=True, fmt="{:.2f}"
    )


def pairwise_l1_distances(X):
    """
    Pairwise L1 (Manhattan / cityblock) distances: sum_i |x_i - y_i|
    Returns an (n x n) matrix. Implemented with broadcasting.
    """
    diffs = X[:, None, :] - X[None, :, :]
    return np.sum(np.abs(diffs), axis=-1)


def pairwise_l2_distances(X):
    """
    Pairwise L2 (Euclidean) distances: sqrt(sum_i (x_i - y_i)^2)
    Returns an (n x n) matrix. Implemented with broadcasting.
    """
    diffs = X[:, None, :] - X[None, :, :]
    return np.linalg.norm(diffs, ord=2, axis=-1)


def pairwise_chebyshev_distances(X):
    """
    Pairwise Chebyshev distances: max_i |x_i - y_i|
    Returns an (n x n) matrix. Implemented with broadcasting.
    """
    diffs = X[:, None, :] - X[None, :, :]
    return np.max(np.abs(diffs), axis=-1)


def pairwise_inner_products(X):
    """
    Pairwise inner products (dot products): x · y
    For X shaped (n, d), returns (n, n) matrix.
    """
    return X @ X.T


def main(n=5, dim=2, seed=42):
    vectors = generate_vectors(n=n, dim=dim, seed=seed)

    # vectors = np.array([
    #     [2, 5],
    #     [1, 4],
    #     [4, 1],
    #     [1, 5],
    #     [3, 3],
    #     [3, 4]
    # ], dtype=float)

    n, dim = vectors.shape

    matrix = vectors  # for clarity
    print("Matrix of vectors (shape: n x dim):")
    print(matrix)


    cos_sim = cosine_similarity(matrix)
    print("\nCosine similarity matrix:")
    print(cos_sim)

    l1 = pairwise_l1_distances(matrix)
    l2 = pairwise_l2_distances(matrix)
    cheb = pairwise_chebyshev_distances(matrix)
    inner = pairwise_inner_products(matrix)

    print("\nL1 (Manhattan) distance matrix:")
    print(l1)
    print("\nL2 (Euclidean) distance matrix:")
    print(l2)
    print("\nChebyshev distance matrix:")
    print(cheb)
    print("\nInner product matrix:")
    print(inner)

    if dim == 2:
        fig = plt.figure(figsize=(14, 8))
        gs = fig.add_gridspec(2, 3)

        ax_vec = fig.add_subplot(gs[0, 0])
        plot_vectors_2d(vectors, ax=ax_vec)

        ax_cos = fig.add_subplot(gs[0, 1])
        plot_cosine_similarity_matrix(cos_sim, ax=ax_cos)

        ax_l1 = fig.add_subplot(gs[0, 2])
        plot_heatmap(l1, ax=ax_l1, title="L1 (Manhattan) Distance", cmap="viridis", vmin=0, vmax=np.max(l1))

        ax_l2 = fig.add_subplot(gs[1, 0])
        plot_heatmap(l2, ax=ax_l2, title="L2 (Euclidean) Distance", cmap="viridis", vmin=0, vmax=np.max(l2))

        ax_cheb = fig.add_subplot(gs[1, 1])
        plot_heatmap(cheb, ax=ax_cheb, title="Chebyshev Distance", cmap="viridis", vmin=0, vmax=np.max(cheb))

        ax_in = fig.add_subplot(gs[1, 2])

        max_abs = float(np.max(np.abs(inner))) if inner.size else 1.0
        plot_heatmap(inner, ax=ax_in, title="Inner Product (Dot) Matrix", cmap="coolwarm", vmin=-max_abs, vmax=max_abs)

    else:
        fig = plt.figure(figsize=(12, 8))
        gs = fig.add_gridspec(2, 2)

        ax_cos = fig.add_subplot(gs[0, 0])
        plot_cosine_similarity_matrix(cos_sim, ax=ax_cos)

        ax_l1 = fig.add_subplot(gs[0, 1])
        plot_heatmap(l1, ax=ax_l1, title="L1 (Manhattan) Distance", cmap="viridis", vmin=0, vmax=np.max(l1))

        ax_l2 = fig.add_subplot(gs[1, 0])
        plot_heatmap(l2, ax=ax_l2, title="L2 (Euclidean) Distance", cmap="viridis", vmin=0, vmax=np.max(l2))

        ax_cheb = fig.add_subplot(gs[1, 1])
        plot_heatmap(cheb, ax=ax_cheb, title="Chebyshev Distance", cmap="viridis", vmin=0, vmax=np.max(cheb))

        fig2, ax_in = plt.subplots(1, 1, figsize=(5, 4))
        max_abs = float(np.max(np.abs(inner))) if inner.size else 1.0
        plot_heatmap(inner, ax=ax_in, title="Inner Product (Dot) Matrix", cmap="coolwarm", vmin=-max_abs, vmax=max_abs)

    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    main(n=6, dim=2, seed=124)
