/** Global variables for easy debugging */
var simulator;

window.addEventListener("load", () => {
    /* Setup WebGL canvas and fluid simulator */
    let canvas = document.getElementById("canvas");
    simulator = new FluidSimRenderer(canvas);
    simulator.init().then(() => {
        simulator.start();
    });

    /* Set up controls */
    let resetButton = document.getElementById("resetButton");
    resetButton.addEventListener("click", () => {
        simulator.uResetType = 2;
    });

    let diffusionSlider = document.getElementById("uDiffusion");
    diffusionSlider.addEventListener("input", e => {
        simulator.uDiffusion = Number(e.target.value);
    });
});