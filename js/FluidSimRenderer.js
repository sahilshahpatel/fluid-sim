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
        let createTexture = () => {
            let texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            
            // See https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/glTexParameter.xhtml for details
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            // All textures will be the same format so that we can have a single temp texture we swap with.
            // RGBA float textures seem the most supported -- RGB32F is not supported on Chrome, for example
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ...this.settings.dataResolution, 0, gl.RGBA, gl.FLOAT, null);
            return texture;
        }

        this.dyeTexture      = createTexture();
        this.velocityTexture = createTexture();
        this.outputTexture   = createTexture();

        
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
    

        ////////////////////////////////////// Mouse Tracking /////////////////////////////////////////////////////////
        this.mouse = {
            pos: [0, 0],
            vel: [0, 0],
        };
        
        let getNextPos = e => [
            e.offsetX * this.settings.dataResolution[0] / this.canvas.clientWidth,
            (this.canvas.offsetHeight - e.offsetY) * this.settings.dataResolution[1] / this.canvas.clientHeight
        ];
        
        this.mousedown = false;
        this.mousemoveTime = performance.now();
        this.canvas.addEventListener('mousedown', e => {
            this.mousemoveTime = performance.now();
            this.mouse.pos = getNextPos(e);
            this.mouse.vel = [0, 0];
        
            this.mousedown = true;
        });
        
        // For mouseup we use document in case they dragged off canvas before mouseup
        document.addEventListener('mouseup',  () => { this.mousedown = false; });
        
        this.canvas.addEventListener('mousemove', e => {
            if (!this.mousedown) return; 
            
            let now = performance.now();
            let dt = (now - this.mousemoveTime) / 1e3;
            this.mousemoveTime = now;
        
            let nextPos = getNextPos(e);
        
            this.mouse.vel = [(nextPos[0] - this.mouse.pos[0]) / dt, (nextPos[1] - this.mouse.pos[1]) / dt];
            this.mouse.pos = nextPos;
        });
    }

    /* Returns a promise to set up this FluidSimRenderer object */
    init(){
        let gl = this.gl;

        // The only important part of Promises you'll need to know here is that in the case of errors or issues, 
        // you should call reject() before returning. Upon successful completion you should call resolve().

        return new Promise( (resolve, reject) => {
            // Create shader program from sources
            Promise.all( [fetchText('glsl/basicVS.glsl'), fetchText('glsl/forces.glsl'),
                          fetchText('glsl/render.glsl')] )
            .then(( [basicVSource, forcesSource, renderSource] ) => {
                
                // We first create shaders and then shader programs from our gathered sources.
                // Each operation we want to perform on our data is its own shader program.
                // Since we are working through the general graphics pipeline and not compute 
                // shaders (which don't yet exist for web), we have all of our programs
                // use the "basicVS" vertex shader which just computes UV coordinates to pass
                // on to the each fragment.

                const VERTEX_SHADER = "x-shader/x-vertex";
                const FRAGMENT_SHADER = "x-shader/x-fragment";

                let basicVS = loadShaderFromSource(gl, basicVSource, VERTEX_SHADER);
                let forcesFS = loadShaderFromSource(gl, forcesSource, FRAGMENT_SHADER);
                let renderFS = loadShaderFromSource(gl, renderSource, FRAGMENT_SHADER);

                let createUniforms = (program, names) => {
                    let uniforms = {};
                    names.forEach( name => {
                        uniforms[name] = gl.getUniformLocation(program, name);
                    });
                    return uniforms;
                };

                this.forcesProgram = createShaderProgram(gl, basicVS, forcesFS);
                if(!this.forcesProgram) { reject(); return; }
                this.forcesUniforms = createUniforms(this.forcesProgram, ['data', 'mousePos', 'mouseVel', 'radius', 'dt', 'res']);

                this.renderProgram = createShaderProgram(gl, basicVS, renderFS);
                if(!this.renderProgram) { reject(); return; }
                this.renderUniforms = createUniforms(this.renderProgram, ['dye', 'vel']);


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
        // All texture operations output to this.outputTexture, so we will have to swap
        // around our textures to mimic outputting to the actual one we want. This is
        // a necessary step because WebGL cannot output to a texture which is also an 
        // input uniform which is often what we want!
        let tmp; // Used to swap textures


        ////////////////////////////////////// Step 3: External Forces ////////////////////////////////////////////////
        // a) Apply forces to velocity
        const radius = 50;
        const mouseVel = this.mousedown ? this.mouse.vel : [0, 0];
        this.applyForces(this.velocityTexture, this.mouse.pos, mouseVel, radius, deltaTime);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;
        
        // b) Add dye around mouse
        const dyeAmount = this.mousedown ? [25, 0] : [0, 0];
        this.applyForces(this.dyeTexture, this.mouse.pos, dyeAmount, radius, deltaTime);
        tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;
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

    
    /**
     * Wrapper for running glsl/forces.glsl
     * Adds to the input texture around the given mouse position
     * with exponential falloff controled by the given radius
     * 
     * @param {Texture} data
     * @param {Vec2} mousePos 
     * @param {Vec2} mouseVel 
     * @param {Float} radius 
     * @param {Float} dt
     */
    applyForces(data, mousePos, mouseVel, radius, dt){
        let gl = this.gl;

        // Use forcesProgram on the full quad
        gl.useProgram(this.forcesProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.forcesProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.forcesProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1i(this.forcesUniforms.data, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, data);

        gl.uniform2fv(this.forcesUniforms.mousePos, mousePos);
        gl.uniform2fv(this.forcesUniforms.mouseVel, mouseVel);
        gl.uniform1f(this.forcesUniforms.radius, radius);
        gl.uniform1f(this.forcesUniforms.dt, dt);
        gl.uniform2fv(this.forcesUniforms.res, this.settings.dataResolution);

        // Render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
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
        let gl = this.gl;

        // Use renderProgram on the full quad
        gl.useProgram(this.renderProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.renderProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.renderProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);
    
        // Set uniforms
        gl.uniform1i(this.renderUniforms.dye, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dyeTexture);

        gl.uniform1i(this.renderUniforms.vel, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture);

        // Render to canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, ...this.settings.renderResolution);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }


    animate(time){
        let deltaTime = (time - this.previousTime) / 1e3;
        this.previousTime = time;

        this.update(deltaTime);
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
        this.clearTexture(this.velocityTexture);
        this.clearTexture(this.dyeTexture);
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