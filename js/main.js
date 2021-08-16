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


    let fullscreenButton = document.getElementById("fullscreenButton");
    let fullscreenToast = document.getElementById("fullscreenToast");
    fullscreenButton.addEventListener("click", () => {
        canvas.classList.add("fullscreen");
        simulator.resize();
        
        fullscreenToast.classList.add("show");
        fullscreenToast.classList.remove("hide");

        // Hide toast after some time
        setTimeout(() => {
            fullscreenToast.classList.remove("show");
            
            // Fully hide toast after opacity transition
            fullscreenToast.addEventListener("transitionend", () => {
                fullscreenToast.classList.add("hide");
            }, {once: true});
        }, 2000);
    });

    document.addEventListener("keydown", e => {
        if(!canvas.classList.contains("fullscreen")) { return; }
        switch(e.key){
            case "Escape":
                fullscreenToast.classList.add("hide");
                canvas.classList.remove("fullscreen");
                simulator.resize();
                break;
            case "q":
                simulator.reset();
                break;
        }
    });

    // TODO: Should probably use a ResizeObserver here, but instead I'll only worry
    // about the fullscreen case
    window.addEventListener("resize", e => {
        if(canvas.classList.contains("fullscreen")){
            simulator.resize();
        }
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

    let qualitySelect = document.getElementById("quality");
    qualitySelect.addEventListener("input", e => {
        simulator.settings["quality"] = Number(e.target.value);
        simulator.resize();
    });
});