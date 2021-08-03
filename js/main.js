/** Global variables for easy debugging */
var simulator;

window.addEventListener("load", () => {
    /* Setup WebGL canvas and fluid simulator */
    let canvas = document.getElementById("canvas");
    simulator = new FluidSimRenderer(canvas);
    simulator.init().then(() => simulator.play());

    /* Set up controls */
    let resetButton = document.getElementById("resetButton");
    resetButton.addEventListener("click", () => { simulator.reset(); });

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
        simulator.reset();
        simulator.init().then(() => { simulator.play() });
    });

    let settings = document.getElementById("settings");
    Array.from(settings.getElementsByTagName("input")).forEach(elt => {
        switch(elt.type){
            case "range":
                elt.addEventListener("input", e => { simulator.settings[elt.id] = Number(e.target.value); });
                break;

            case "checkbox":
                elt.addEventListener("input", e => { simulator.settings[elt.id] = e.target.checked ? 1 : 0; });
                break;
        }
    });
});