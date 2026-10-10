import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics.pairwise import cosine_similarity

# Enables 3D projection
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401


def generate_vectors(n, dim=2, seed=None):
    """Generate n random vectors of given dimension."""
    rng = np.random.default_rng(seed)
    return rng.normal(size=(n, dim))


def select_topk_by_cosine(vectors, query_idx=0, k=3, include_query=True):
    """
    Select top-k vectors most similar to vectors[query_idx] by cosine similarity.
    Returns: (selected_indices: list[int], selected_scores: np.ndarray)
    """
    cos = cosine_similarity(vectors)  # (n,n)
    scores = cos[query_idx].copy()
    if not include_query:
        scores[query_idx] = -np.inf

    k = min(k, vectors.shape[0])
    selected = np.argsort(scores)[::-1][:k]
    return selected.tolist(), scores[selected]


def plot_vectors_2d(vectors, ax=None, origin=(0, 0), colors=None, labels=None, title="2D Vectors"):
    """Plot 2D vectors from a common origin using quiver."""
    if vectors.shape[1] != 2:
        raise ValueError("plot_vectors_2d requires 2D vectors (n x 2).")

    if ax is None:
        _, ax = plt.subplots()

    n = vectors.shape[0]
    x0, y0 = origin

    X = np.full(n, x0)
    Y = np.full(n, y0)
    U = vectors[:, 0]
    V = vectors[:, 1]

    if colors is None:
        colors = np.arange(n)

    if labels is None:
        labels = [f"v{i}" for i in range(n)]

    ax.quiver(
        X, Y, U, V,
        angles="xy",
        scale_units="xy",
        scale=1,
        color=plt.cm.tab10(colors % 10),
    )

    for i, (u, v) in enumerate(zip(U, V)):
        ax.text(u * 1.05, v * 1.05, labels[i], fontsize=9)

    ax.set_xlabel("x")
    ax.set_ylabel("y")
    ax.set_title(title)
    ax.axhline(0, color="grey", linewidth=0.5)
    ax.axvline(0, color="grey", linewidth=0.5)
    ax.set_aspect("equal", "box")

    all_x = np.concatenate([X, X + U])
    all_y = np.concatenate([Y, Y + V])
    margin = 0.2
    ax.set_xlim(all_x.min() - margin, all_x.max() + margin)
    ax.set_ylim(all_y.min() - margin, all_y.max() + margin)
    return ax


def plot_vectors_3d(
    vectors,
    ax=None,
    origin=(0, 0, 0),
    colors=None,
    labels=None,
    length=1.0,
    normalize=False,
    title="3D Vectors",
):
    """
    Plot vectors in 3D using quiver.
    - If vectors are 2D, they are embedded in 3D by setting z=0.
    - If vectors are 3D, they are plotted directly.
    Matplotlib 3D quiver supports (X,Y,Z,U,V,W, length=..., normalize=...). [web:3]
    """
    d = vectors.shape[1]
    if d not in (2, 3):
        raise ValueError("plot_vectors_3d supports only 2D or 3D vectors (n x 2 or n x 3).")

    if ax is None:
        fig = plt.figure(figsize=(7, 6))
        ax = fig.add_subplot(111, projection="3d")

    n = vectors.shape[0]
    if colors is None:
        colors = np.arange(n)
    if labels is None:
        labels = [f"v{i}" for i in range(n)]

    x0, y0, z0 = origin

    if d == 2:
        U = vectors[:, 0]
        V = vectors[:, 1]
        W = np.zeros(n)
    else:
        U = vectors[:, 0]
        V = vectors[:, 1]
        W = vectors[:, 2]

    X = np.full(n, x0, dtype=float)
    Y = np.full(n, y0, dtype=float)
    Z = np.full(n, z0, dtype=float)

    ax.quiver(
        X, Y, Z,
        U, V, W,
        length=length,
        normalize=normalize,
        color=plt.cm.tab10(colors % 10),
    )

    # endpoints + labels
    ax.scatter(X + U, Y + V, Z + W, s=30, c=plt.cm.tab10(colors % 10))
    for i, (px, py, pz) in enumerate(zip(X + U, Y + V, Z + W)):
        ax.text(px, py, pz, labels[i], fontsize=9)

    ax.set_xlabel("x")
    ax.set_ylabel("y")
    ax.set_zlabel("z")
    ax.set_title(title)

    # bounds
    all_x = np.concatenate([X, X + U])
    all_y = np.concatenate([Y, Y + V])
    all_z = np.concatenate([Z, Z + W])
    margin = 0.2
    ax.set_xlim(all_x.min() - margin, all_x.max() + margin)
    ax.set_ylim(all_y.min() - margin, all_y.max() + margin)
    ax.set_zlim(all_z.min() - margin, all_z.max() + margin)
    return ax


def plot_heatmap(
    matrix,
    ax=None,
    title="Heatmap",
    cmap="Blues",
    vmin=None,
    vmax=None,
    annotate=True,
    fmt="{:.2f}",
):
    """Generic heatmap helper using imshow."""
    if ax is None:
        _, ax = plt.subplots()

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
                ax.text(j, i, fmt.format(matrix[i, j]), ha="center", va="center", fontsize=7, color="black")

    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    return ax


def plot_cosine_similarity_matrix(sim_matrix, ax=None):
    """Visualize cosine similarity matrix as a heatmap."""
    return plot_heatmap(
        sim_matrix,
        ax=ax,
        title="Cosine Similarity Matrix",
        cmap="Blues",
        vmin=-1,
        vmax=1,
        annotate=True,
        fmt="{:.2f}",
    )


def pairwise_l1_distances(X):
    diffs = X[:, None, :] - X[None, :, :]
    return np.sum(np.abs(diffs), axis=-1)


def pairwise_l2_distances(X):
    diffs = X[:, None, :] - X[None, :, :]
    return np.linalg.norm(diffs, ord=2, axis=-1)


def pairwise_chebyshev_distances(X):
    diffs = X[:, None, :] - X[None, :, :]
    return np.max(np.abs(diffs), axis=-1)


def pairwise_inner_products(X):
    return X @ X.T


def main(n=6, dim=2, seed=124, query_idx=0, top_k=4, include_query=True):
    vectors = generate_vectors(n=n, dim=dim, seed=seed)
    matrix = vectors

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

    # --- Select vectors to display ---
    selected_idx, selected_scores = select_topk_by_cosine(
        vectors, query_idx=query_idx, k=top_k, include_query=include_query
    )

    print("\nSelected vector indices:", selected_idx)
    print(f"Selected cosine scores vs v{query_idx}:", selected_scores)
    print("\nSelected vectors:")
    for i in selected_idx:
        print(f"v{i} = {vectors[i]}")

    selected_vectors = vectors[selected_idx]
    selected_labels = [f"v{i}" for i in selected_idx]
    selected_colors = np.arange(len(selected_idx))

    # --- Visualizations ---
    if dim == 2:
        # Figure 1: 2D + matrices
        fig = plt.figure(figsize=(16, 8))
        gs = fig.add_gridspec(2, 3)

        ax_vec = fig.add_subplot(gs[0, 0])
        plot_vectors_2d(
            selected_vectors,
            ax=ax_vec,
            colors=selected_colors,
            labels=selected_labels,
            title=f"Selected 2D vectors: {selected_idx}",
        )

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

        plt.tight_layout()

        # Figure 2: 3D view of the SAME selected vectors (embedded in z=0 plane)
        fig3d = plt.figure(figsize=(8, 7))
        ax3d = fig3d.add_subplot(111, projection="3d")
        plot_vectors_3d(
            selected_vectors,
            ax=ax3d,
            colors=selected_colors,
            labels=selected_labels,
            length=1.0,
            normalize=False,
            title=f"Selected vectors in 3D (z=0): {selected_idx}",
        )

        plt.tight_layout()
        plt.show()

    else:
        # For dim != 2: matrices, and 3D plot only if dim == 3
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

        plt.tight_layout()

        if dim == 3:
            fig3d = plt.figure(figsize=(8, 7))
            ax3d = fig3d.add_subplot(111, projection="3d")
            plot_vectors_3d(
                selected_vectors,
                ax=ax3d,
                colors=selected_colors,
                labels=selected_labels,
                length=1.0,
                normalize=False,
                title=f"Selected 3D vectors: {selected_idx}",
            )
            plt.tight_layout()

        fig2, ax_in = plt.subplots(1, 1, figsize=(5, 4))
        max_abs = float(np.max(np.abs(inner))) if inner.size else 1.0
        plot_heatmap(inner, ax=ax_in, title="Inner Product (Dot) Matrix", cmap="coolwarm", vmin=-max_abs, vmax=max_abs)

        plt.show()


if __name__ == "__main__":
    main(n=6, dim=2, seed=124, query_idx=0, top_k=4, include_query=True)
