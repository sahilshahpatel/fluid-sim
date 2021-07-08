/** Global variables for easy debugging */
var simulator;

window.addEventListener("load", () => {
    let canvas = document.getElementById("canvas");

    simulator = new FluidSimRenderer(canvas);
    simulator.init().then(() => {
        simulator.start();
    });

    let resetButton = document.getElementById("resetButton");
    resetButton.addEventListener("click", e => {
        simulator.reset();
    });
});