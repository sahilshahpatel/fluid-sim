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
uniform int uReset;                     // Reset flag
in vec2 fragUV;                         // Fragment position with [0, 1] coordinates and bottom-left origin

out vec4 fragColor;                     // The final color for this fragment

/* Function List */
vec4 diffusion(void);

/** void main(void)
DESCRIPTION: The main function of the fragment shader. Implements one iteration of Gauss-Seidel approximation.
*/
void main(void){
    // If the reset flag is high, output a known initial state. Otherwise, proceed
    switch(uReset){
        case 0: // Normal operation
        break;

        case 1: // Reset to center-locus
        fragColor = vec4(1, 0, 0, 1. - step(0.1, length(fragUV - 0.5)));
        return;
    }
    
    /* Step One: Diffusion */
    fragColor = diffusion();
}

vec4 diffusion(void){
    // fragUV is a vec2 with both components from [0, 1]. Multiplying it by our resolution will make each fragment's
    //  value for fragXY an integer which can be a helpful abstraction (see its use below)
    vec2 fragXY = fragUV * uResolution;


    // For diffusion we must mix between our previous value and that of our neighbors in a hyperbolic relation
    // d_n = (d_c + k*s_n) / (1 + k) where:
    //   -- d_n is the density of this fragment in the next frame
    //   -- d_c is the desntiy of this fragment on the last frame
    //   -- k   is the mixing factor, proportional to the time delta
    //   -- s_n is the next average density of our neighbors
    // Since this is just one iteration of a Gauss-Seidel approximation, we use uPreviousIteration for our "next" values

    vec4 d_c   = texture(uPreviousFrame, fragUV);
    vec4 left  = texture(uPreviousIteration, (fragXY + vec2(-1,  0)) / uResolution);
    vec4 right = texture(uPreviousIteration, (fragXY + vec2( 1,  0)) / uResolution);
    vec4 up    = texture(uPreviousIteration, (fragXY + vec2( 0, -1)) / uResolution);
    vec4 down  = texture(uPreviousIteration, (fragXY + vec2( 0,  1)) / uResolution);

    vec4 s_n = (left + right + up + down) / 4.0;

    return (d_c + uDeltaTime * s_n) / (1.0 + uDeltaTime);
}