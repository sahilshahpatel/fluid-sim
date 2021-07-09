#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPreviousFrame;       // Data from last frame of simulation
uniform sampler2D uPreviousIteration;   // Data from last iteration of Gauss-Seidel method
uniform vec2 uResolution;               // Canvas resolution - 1 for converting to "integer indices"
uniform float uDeltaTime;               // Time since last frame
uniform float uDiffusion;               // The diffusion factor
uniform int uReset;                     // Reset flag
uniform int uMode;                      // Mode selector (diffusion, advection, divergence-correction)
in vec2 fragUV;                         // Fragment position with [0, 1] coordinates and bottom-left origin

out vec4 fragColor;                     // The final color for this fragment

/* Structures and Constants */
const int RESET_NONE = 0;
const int RESET_CENTER = 1;
const int RESET_CORNER = 2;
const int MODE_DIFFUSION = 0;
const int MODE_ADVECTION = 1;
const int MODE_PROJECTION = 2;

/* Global Variables */
vec2 fragXY;                            // "World space" coordinates (i.e. the would-be index into the frame buffer)
vec2 fragST;                            // "Texture space" coordinates (i.e. fragXY + vec2(0.5) in order to center the pixels)
vec4 previousFrameData;
vec4 previousIterationData;

/* Function List */
vec4 diffusion(void);
vec4 advection(void);

/** void main(void)
DESCRIPTION: The main function of the fragment shader. Implements one iteration of Gauss-Seidel approximation.
INPUTS:      None
OUTPUTS:     Sets the value of fragColor, the output color of this fragment
*/
void main(void){
    // We have three types of coordinates per fragment, each useful in different places:
    //   -- uv: UV coordinates are always in [0, 1] and can be thought of as the percentage along in that direction.
    //          They are most useful when looking at previous frame/iteration data for this fragment since the GLSL
    //          texture() function takes in UV coordinates
    //   -- st: ST coordinates are what I call "texture coordinates," and is what the GPU will convert your UV coordinates 
    //          into inside the texture() call. The most important note is that for an ST coordinate to be exactly on a 
    //          pixel, fract(st) == vec2(0.5). ST coordinates are useful for texture() calls where we want to find neighbors
    //   -- xy: XY coordinates are what I call "world space coordinates." They are exactly equal to ST - vec2(0.5), so that 
    //          pixels are centered at integer coordinates. These are like the 2D array indexes you might use to do this in C.
    fragST = fragUV * uResolution;
    fragXY = fragST - 0.5;


    // If the reset flag is high, output a known initial state. Otherwise, proceed
    switch(uReset){
        case RESET_NONE:
        break;

        case RESET_CENTER:
        fragColor = vec4(0, 0, 0, 1. - step(0.1, length(fragUV - 0.5)));
        return;

        case RESET_CORNER:
        fragColor = vec4(1, 1, 0, 1. - step(2., length(fragXY)));
        return;
    }

    previousFrameData = texture(uPreviousFrame, fragUV);
    previousIterationData = texture(uPreviousIteration, fragUV);
    
    /* This shader is used multiple times for different purposes, so we need to check which mode we're in */
    switch(uMode){
        case MODE_DIFFUSION:
        fragColor = diffusion();
        return;

        case MODE_ADVECTION:
        fragColor = advection();
        return;

        case MODE_PROJECTION:
        return;
    }
}


/** vec4 diffusion(void)
DESCRIPTION: Implements diffusion of all fluid properties (including density and velocity)
INPUTS:      None
OUTPUTS:     The vec4 of properties for this fragment on the next frame after diffusion
*/
vec4 diffusion(void){
    // For diffusion we must mix between our previous value and that of our neighbors in a hyperbolic relation
    // d_n = (d_c + k*s_n) / (1 + k) where:
    //   -- d_n is the density of this fragment in the next frame
    //   -- d_c is the desntiy of this fragment on the last frame
    //   -- k   is the mixing factor, proportional to the time delta
    //   -- s_n is the next average density of our neighbors
    // Above we use density as one example, but this same diffusion process happens for all scalar values (including the 
    // components of velocity each as separate scalars)
    // Since this is just one iteration of a Gauss-Seidel approximation, we use uPreviousIteration for our "next" values

    vec4 d_c   = previousFrameData;
    vec4 left  = texture(uPreviousIteration, (fragST + vec2(-1,  0)) / uResolution);
    vec4 right = texture(uPreviousIteration, (fragST + vec2( 1,  0)) / uResolution);
    vec4 up    = texture(uPreviousIteration, (fragST + vec2( 0, -1)) / uResolution);
    vec4 down  = texture(uPreviousIteration, (fragST + vec2( 0,  1)) / uResolution);

    vec4 s_n = (left + right + up + down) / 4.0;

    float k = uDiffusion * uDeltaTime;

    vec4 d_n = (d_c + k * s_n) / (1.0 + k);
    return d_n;
}


/** vec4 advection(void)
DESCRIPTION: Implements advection for all fluid properties (including density and velocity). Advection is the 
             process by which properties move along with velocity. 
INPUTS:      None
OUTPUTS:     The vec4 of properties for this fragment on the next frame after advection
*/
vec4 advection(void){
    // In advection it is again easiest to go backwards. We will find the spot where fluid will flow into the fragment.
    vec2 source = fragXY - previousFrameData.xy * uDeltaTime;

    // The source may not be just one grid cell, so we will use bilinear interpolation
    vec2 i = floor(source) + 0.5; // convert back to ST before texture() call
    vec2 j = fract(source);

    vec4 a = texture(uPreviousIteration,  i / uResolution);
    vec4 b = texture(uPreviousIteration, (i + vec2(1, 0)) / uResolution);
    vec4 c = texture(uPreviousIteration, (i + vec2(0, 1)) / uResolution);
    vec4 d = texture(uPreviousIteration, (i + vec2(1, 1)) / uResolution);

    vec4 inFlow = mix(mix(a, b, j.x), mix(c, d, j.x), j.y);

    return inFlow;
}