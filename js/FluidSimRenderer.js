class FluidSimRenderer {
    constructor(canvas){
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");
        let gl = this.gl;

        if(!gl){
            console.error("Failed to get WebGL2 context!");
            return;
        }

        if(!gl.getExtension("EXT_color_buffer_float")){
            console.error("Error: This requires EXT_color_buffer_float extension to work properly");
            return;
        }

        if(!gl.getExtension("OES_texture_float_linear")){
            console.error("Error: This requires OES_texture_float_linear extension to work properly");
            return;
        }

        
        ////////////////////////////////////// Configuration parameters ///////////////////////////////////////////////
        // These settings are controlled via HTML UI controls, but their initial values are set here.
        this.settings = {};
        this.settings.dataResolution = [320, 200];          // Resolution of data for processing
        this.settings.renderResolution = [800, 500];        // Resolution of rendering (important for velocity arrow display)

        
        ////////////////////////////////////// Initialize internal fields /////////////////////////////////////////////
        this.requestAnimationFrameID = undefined;           // Used for pausing simulation
        this.previousTime = 0;                              // Used to calculate the time delta between frams
        this.deltaTime = 0;                                 // Stores time delta between frames
        [this.canvas.width, this.canvas.height] = this.settings.renderResolution;   // Makes renderResolution actually work!

        
        ////////////////////////////////////// Create required textures and VAOs //////////////////////////////////////
        // A framebuffer is the tool we need to be able to render-to-texture.
        // Essentially, it will let us make our fragment shaders output to our 
        // textures instead of showing up on screen. This allows us to use them
        // in subsequent steps.
        this.framebuffer = gl.createFramebuffer();
        this.copyFramebuffer = gl.createFramebuffer(); // We need a second FB for copying textures


        // We will also need two sets of Vertex Array Objects (VAOs) and 
        // vertex buffers. This is because we will be running our main 
        // set of programs on a big quad (rectangle), but the boundary of
        // our screen will have a separate program run to enforce boundary conditions.
        this.quad = {
            vao: gl.createVertexArray(),
            buffer: gl.createBuffer(),
            data: [
                -1, -1, 0,
                -1, +1, 0,
                +1, -1, 0,
                -1, +1, 0,
                +1, -1, 0,
                +1, +1, 0,
            ],
            itemSize: 3,
            nItems: 6,
            glDrawEnum: gl.TRIANGLES,
        };
        gl.bindVertexArray(this.quad.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.quad.data), gl.STATIC_DRAW);

        // dx, dy are deltas to get our lines to go straight through data cell centers
        let dx = 1 / this.settings.dataResolution[0];
        let dy = 1 / this.settings.dataResolution[1];
        this.boundary = {
            vao: gl.createVertexArray(),
            buffer: gl.createBuffer(),
            data: [
                -1+dx, -1+dy, 0,
                -1+dx, +1-dy, 0,
                +1-dx, +1-dy, 0,
                +1-dx, -1+dy, 0,
                -1+dx, -1+dy, 0,
            ],
            itemSize: 3,
            nItems: 5,
            glDrawEnum: gl.LINES,
        };
        gl.bindVertexArray(this.boundary.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.boundary.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.boundary.data), gl.STATIC_DRAW);
    }

    /* Returns a promise to set up this FluidSimRenderer object */
    init(){
        let gl = this.gl;

        // The only important part of Promises you'll need to know here is that in the case of errors or issues, 
        // you should call reject() before returning. Upon successful completion you should call resolve().

        return new Promise( (resolve, reject) => {
            // Create shader program from sources
            Promise.all( [fetchText('glsl/basicVS.glsl')] )
            .then(( [basicVSource] ) => {
                
                // We first create shaders and then shader programs from our gathered sources.
                // Each operation we want to perform on our data is its own shader program.
                // Since we are working through the general graphics pipeline and not compute 
                // shaders (which don't yet exist for web), we have all of our programs
                // use the "basicVS" vertex shader which just computes UV coordinates to pass
                // on to the each fragment.

                const VERTEX_SHADER = "x-shader/x-vertex";
                const FRAGMENT_SHADER = "x-shader/x-fragment";

                let basicVS = loadShaderFromSource(gl, basicVSource, VERTEX_SHADER);
                

                resolve();
            });
        });
    }

    
    /**
     * Performs one step of the simulation in multiples stages:
     * Stage 1: Advection
     * Stage 2: Diffusion
     * Stage 3: External forces
     * Stage 4: Projection
     * Stage 5: Render to screen
     * 
     * @param {Number} deltaTime time since the last update
     */
    update(deltaTime){
        // TODO (Chapter 4)
    }


    ////////////////////////////////////// Texture Operations /////////////////////////////////////////////////////////
    // We abstract out each texture operation as a function which takes in the uniform values to pass in.
    // All functions output to this.outputTexture
    
    advect(){
        // TODO (Chapter 5)
    }

    
    jacobi(){
        // TODO (Chapter 6)    
    }

    
    applyForces(){
        // TODO (Chapter 4)
    }


    computeDivergence(){
        // TODO (Chapter 7)
    }


    removeDivergence(){
        // TODO (Chapter 7)
    }


    computeCurl(){
        // TODO (Chapter 8)
    }


    enforceBoundary(){
        // TODO (Chapter 7)
    }


    render(){
        // TODO (Chapter 3)
    }


    animate(time){
        let deltaTime = time - this.previousTime;
        this.previousTime = time;
        
        this.update(deltaTime / 1e3);
        this.render();
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }


    play(){
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }


    pause(){
        let gl = this.gl;
        cancelAnimationFrame(this.requestAnimationFrameID);
        this.requestAnimationFrameID = undefined;
        gl.useProgram(null);
    }


    reset(){
        // TODO (Chapter 3)
    }


    ///////////////////////////////////////// Helper Functions ////////////////////////////////////////////////////////

    clearTexture(tex, r = 0, g = 0, b = 0, a = 0){
        let gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.clearColor(r, g, b, a);
        
        gl.clear(gl.COLOR_BUFFER_BIT);
    }


    copyTexture(src, dst){
        let gl = this.gl;

        // From https://stackoverflow.com/questions/26303783/webgl-copy-texture-framebuffer-to-texture-framebuffer
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);

        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFramebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);

        gl.blitFramebuffer(0, 0, ...this.settings.dataResolution, 0, 0, ...this.settings.dataResolution, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
}