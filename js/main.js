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
    let resetOptions = document.getElementById("resetOptions");
    resetOptions.querySelectorAll(".dropdown-item").forEach((opt, i) => {
        // This assumes that the HTML elements are in the same order as the
        // "enums" in the reset fragment shader. We use +1 because the resetTypes
        // start from 1 (where type 0 means "don't reset")
        opt.addEventListener("click", () => {simulator.uResetType = i+1;});
    });

    let diffusionSlider = document.getElementById("uDiffusion");
    diffusionSlider.addEventListener("input", e => {
        simulator.uDiffusion = Number(e.target.value);
    });
});