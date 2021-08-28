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
        this.settings.drawRadius = 50;                      // Radius used in applyForces
        this.settings.dyeAmount = 25;                       // Amount of dye used in external forces (in update)
        this.settings.diffusionIterations = 20;             // Number of jacobi iterations for diffusion
        this.settings.diffusionStrength = 1;                // Strength of diffusion
        this.settings.projectionIterations = 40;            // Number of jacobi iterations for pressure calculation
        
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
        this.divergenceTexture = createTexture();
        this.pressureTexture = createTexture();
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
                          fetchText('glsl/advection.glsl'), fetchText('glsl/jacobi.glsl'),
                          fetchText('glsl/divergence.glsl'), fetchText('glsl/pGradient.glsl'),
                          fetchText('glsl/boundary.glsl'), fetchText('glsl/render.glsl')] )
            .then(( [basicVSource, forcesSource, advectSource, jacobiSource, 
                divergenceSource, pGradientSource, boundarySource, renderSource] ) => {
                
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
                let advectFS = loadShaderFromSource(gl, advectSource, FRAGMENT_SHADER);
                let jacobiFS = loadShaderFromSource(gl, jacobiSource, FRAGMENT_SHADER);
                let divergenceFS = loadShaderFromSource(gl, divergenceSource, FRAGMENT_SHADER);
                let pGradientFS = loadShaderFromSource(gl, pGradientSource, FRAGMENT_SHADER);
                let boundaryFS = loadShaderFromSource(gl, boundarySource, FRAGMENT_SHADER);
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

                this.advectProgram = createShaderProgram(gl, basicVS, advectFS);
                if(!this.advectProgram) { reject(); return; }
                this.advectUniforms = createUniforms(this.advectProgram, ['data', 'vel', 'dt', 'res']);

                this.jacobiProgram = createShaderProgram(gl, basicVS, jacobiFS);
                if(!this.jacobiProgram) { reject(); return; }
                this.jacobiUniforms = createUniforms(this.jacobiProgram, ['x', 'y', 'alpha', 'beta', 'res']);

                this.divergenceProgram = createShaderProgram(gl, basicVS, divergenceFS);
                if(!this.divergenceProgram) { reject(); return; }
                this.divergenceUniforms = createUniforms(this.divergenceProgram, ['field', 'res']);

                this.pGradientProgram = createShaderProgram(gl, basicVS, pGradientFS);
                if(!this.pGradientProgram) { reject(); return; }
                this.pGradientUniforms = createUniforms(this.pGradientProgram, ['vel', 'pressure', 'res']);

                this.boundaryProgram = createShaderProgram(gl, basicVS, boundaryFS);
                if(!this.boundaryProgram) { reject(); return; }
                this.boundaryUniforms = createUniforms(this.boundaryProgram, ['data', 'res', 'offset', 'scale']);

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


        ////////////////////////////////////// Step 1: Advection //////////////////////////////////////////////////////
        // a) Advect velocity
        this.advect(this.velocityTexture, this.velocityTexture, deltaTime);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;

        // b) Advect dye
        this.advect(this.dyeTexture, this.velocityTexture, deltaTime);
        tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;


        ////////////////////////////////////// Step 2: Diffusion //////////////////////////////////////////////////////
        let k = this.settings.diffusionStrength * deltaTime;

        // a) Diffuse velocity
        for(let i = 0; k > 0 && i < this.settings.diffusionIterations; i++){
            this.jacobi(this.velocityTexture, this.velocityTexture, 4/k, 4/k * (1+k));
            tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;
        }

        // b) Diffuse dye
        for(let i = 0; k > 0 && i < this.settings.diffusionIterations; i++){
            this.jacobi(this.dyeTexture, this.dyeTexture, 4/k, 4/k * (1+k));
            tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;
        }


        ////////////////////////////////////// Step 3: External Forces ////////////////////////////////////////////////
        // a) Apply forces to velocity
        const mouseVel = this.mousedown ? this.mouse.vel : [0, 0];
        this.applyForces(this.velocityTexture, this.mouse.pos, mouseVel, this.settings.drawRadius, deltaTime);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;
        
        // b) Add dye around mouse
        const dyeAmount = this.mousedown ? [this.settings.dyeAmount, 0] : [0, 0];
        this.applyForces(this.dyeTexture, this.mouse.pos, dyeAmount, this.settings.drawRadius, deltaTime);
        tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;
        

        ////////////////////////////////////// Step 4: Projection /////////////////////////////////////////////////////
        // a) Calculate divergence of velocity
        this.computeDivergence(this.velocityTexture);
        tmp = this.divergenceTexture; this.divergenceTexture = this.outputTexture; this.outputTexture = tmp;

        // b) Calculate pressure field
        this.clearTexture(this.pressureTexture);
        for(let i = 0; i < this.settings.projectionIterations; i++){
            this.jacobi(this.pressureTexture, this.divergenceTexture, -1, 4);
            tmp = this.pressureTexture; this.pressureTexture = this.outputTexture; this.outputTexture = tmp;    
            
            this.enforceBoundary(this.pressureTexture, 1);
            tmp = this.pressureTexture; this.pressureTexture = this.outputTexture; this.outputTexture = tmp;
        }
        
        // c) Subtract the pressure gradient
        this.removeDivergence(this.velocityTexture, this.pressureTexture);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;


        ////////////////////////////////////// Step 5: Boundary Condition /////////////////////////////////////////////
        this.enforceBoundary(this.velocityTexture, -1);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;
    }


    ////////////////////////////////////// Texture Operations /////////////////////////////////////////////////////////
    // We abstract out each texture operation as a function which takes in the uniform values to pass in.
    // All functions output to this.outputTexture
    
    /**
     * Wrapper for running glsl/advect.glsl
     * Moves a quantity according to a given velocity field
     * 
     * @param {Texture} data 
     * @param {Texture} vel 
     * @param {Float} dt 
     */
    advect(data, vel, dt){
        let gl = this.gl;

        // Use advectProgram on the full quad
        gl.useProgram(this.advectProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.advectProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.advectProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1i(this.advectUniforms.data, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, data);

        if(data === vel){
            gl.uniform1i(this.advectUniforms.vel, 0);
        }
        else{
            gl.uniform1i(this.advectUniforms.vel, 1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, vel);
        }

        gl.uniform1f(this.advectUniforms.dt, dt);
        gl.uniform2fv(this.advectUniforms.res, this.settings.dataResolution);

        // Render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /**
     * Wrapper for running glsl/jacobi.glsl
     * Uses Jacobi iteration to solve a system of equations of the form
     * x^{n+1}_{i, j} = \frac{\alpha * y^{n}_{i,j} + 4 * s^{n+1}_{i,j}}{\beta}
     * where s is the average value of the cardinal neighbors of x.
     * 
     * @param {Texture} x 
     * @param {Texture} y 
     * @param {Float} alpha 
     * @param {Float} beta 
     */
    jacobi(x, y, alpha, beta){
        let gl = this.gl;

        // Use jacobiProgram on the full quad
        gl.useProgram(this.jacobiProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.jacobiProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.jacobiProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1i(this.jacobiUniforms.x, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, x);

        if(x === y){
            gl.uniform1i(this.jacobiUniforms.y, 0);
        }
        else{
            gl.uniform1i(this.jacobiUniforms.y, 1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, y);
        }

        gl.uniform1f(this.jacobiUniforms.alpha, alpha);
        gl.uniform1f(this.jacobiUniforms.beta, beta);
        gl.uniform2fv(this.jacobiUniforms.res, this.settings.dataResolution);

        // Render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);    
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


    /**
     * Wrapper for running glsl/divergence.glsl
     * Computes the divergence of an input 2D vector field
     * 
     * @param {Texture} field
     */
    computeDivergence(field){
        let gl = this.gl;

        // Use divergenceProgram on the full quad
        gl.useProgram(this.divergenceProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.divergenceProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.divergenceProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1i(this.divergenceUniforms.field, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, field);

        gl.uniform2fv(this.divergenceUniforms.res, this.settings.dataResolution);

        // Render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }


    /**
     * Wrapper for glsl/pGradient.glsl
     * Computes the gradient of the pressure field
     * and subtracts it from the velocity
     * 
     * @param {Texture} vel
     * @param {Texture} pressure
     */
    removeDivergence(vel, pressure){
        let gl = this.gl;

        // Use forcesProgram on the full quad
        gl.useProgram(this.pGradientProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.pGradientProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.pGradientProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1i(this.pGradientUniforms.vel, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, vel);

        gl.uniform1i(this.pGradientUniforms.pressure, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pressure);

        gl.uniform2fv(this.pGradientUniforms.res, this.settings.dataResolution);

        // Render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }


    computeCurl(){
        // TODO (Chapter 8)
    }


    /**
     * Wrapper for running glsl/boundary.glsl
     * Sets the boundary cells equal to their inner neighbor's value
     * multiplied by scale
     * 
     * @param {Texture} data 
     * @param {Float} scale 
     */
    enforceBoundary(data, scale){
        let gl = this.gl;

        // First copy the data texture into outputTexture so that non-boundary pixels remain the same
        this.copyTexture(data, this.outputTexture);

        // Use boundaryProgram on the full quad
        gl.useProgram(this.boundaryProgram);
        gl.bindVertexArray(this.boundary.vao);
        gl.enableVertexAttribArray(this.boundaryProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.boundary.buffer);
        gl.vertexAttribPointer(this.boundaryProgram.vertexPositionAttribute, this.boundary.itemSize, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1i(this.boundaryUniforms.data, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, data);

        gl.uniform1f(this.boundaryUniforms.scale, scale);
        gl.uniform2fv(this.boundaryUniforms.res, this.settings.dataResolution);

        // Render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        
        // We will need to repeat this process with different offsets for each boundary line
        let offsets = [[1, 0], [0, -1], [-1, 0], [0, 1]]; // left, top, right, bottom line order (from boundary.data)
        for(let i = 0; i < 4; i ++){
            gl.uniform2fv(this.boundaryUniforms.offset, offsets[i]);
            gl.drawArrays(gl.LINES, i, 2);
        }
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