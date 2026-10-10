# GPU support in docker-desktop on windows

[Guide](https://docs.docker.com/desktop/features/gpu/)

## Nvidia GPU test in docker
---
> docker run --rm -it --gpus=all nvcr.io/nvidia/k8s/cuda-sample:nbody nbody -gpu -benchmark

Example output:
``` bash
NOTE: The CUDA Samples are not meant for performance measurements. Results may vary when GPU Boost is enabled.

> Windowed mode
> Simulation data stored in video memory
> Single precision floating point simulation
> 1 Devices used for simulation
GPU Device 0: "Ampere" with compute capability 8.6

> Compute 8.6 CUDA device: [NVIDIA GeForce RTX 3080]
69632 bodies, total time for 10 iterations: 71.695 ms
= 676.280 billion interactions per second
= 13525.605 single-precision GFLOP/s at 20 flops per interaction 
```

# Ollama container with GPU support

> docker run --gpus=all -d -v ollama-models:/root/.ollama -p 11434:11434 --name ollama ollama/ollama


**Note**: Ensure to export ```PYTHONPATH``` variable in your command line or runtime env to adjust for your code paths.
