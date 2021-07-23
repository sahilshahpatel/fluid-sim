/** Global variables for easy debugging */
var simulator;

window.addEventListener("load", () => {
    /* Setup WebGL canvas and fluid simulator */
    let canvas = document.getElementById("canvas");
    simulator = new FluidSimRenderer(canvas);
    simulator.init().then(() => simulator.play());

    /* Set up controls */
    let resetOptions = document.getElementById("resetOptions");
    resetOptions.querySelectorAll(".dropdown-item").forEach((opt, i) => {
        // This assumes that the HTML elements are in the same order as the
        // "enums" in the reset fragment shader. We use +1 because the resetTypes
        // start from 1 (where type 0 means "don't reset")
        opt.addEventListener("click", () => {simulator.uResetType = i+1;});
    });

    let playButton = document.getElementById("playButton");
    let pauseButton = document.getElementById("pauseButton");
    playButton.addEventListener("click", () => {
        // Set previousTime to now (therefore deltaTime to ~0) to avoid big jump on next frame
        simulator.previousTime = performance.now();

        simulator.play();
        playButton.classList.add("d-none");
        pauseButton.classList.remove("d-none");
    });
    pauseButton.addEventListener("click", () => {
        simulator.pause();
        playButton.classList.remove("d-none");
        pauseButton.classList.add("d-none");
    });

    let refreshButton = document.getElementById("refreshButton");
    refreshButton.addEventListener("click", () => {
        simulator.pause();
        simulator.init().then(() => {simulator.uResetType = 1; simulator.play()});
    });

    let diffusionSlider = document.getElementById("uDiffusion");
    diffusionSlider.addEventListener("input", e => {
        simulator.uDiffusion = Number(e.target.value);
    });
});