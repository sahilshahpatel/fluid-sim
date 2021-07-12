#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;               // Resolution of the texture we are rendering to
uniform int uResetType;                 // Indicates what we should reset to
in vec2 fragUV;                         // Fragment position with [0, 1] coordinates and bottom-left origin

out vec4 fragColor;                     // The final color for this fragment

/* Constants */
const int RESET_NONE = 0; // Shouldn't ever be used, but just in case
const int RESET_CENTER = 1;
const int RESET_CORNER = 2;


/** void main(void)
DESCRIPTION: The main function of the fragment shader. Resets the canvas with hard-coded output.
INPUTS:      None
OUTPUTS:     Sets the value of fragColor, the output color of this fragment
*/
void main(void){
    vec2 fragXY = fragUV * uResolution - 0.5;

    float d;

    switch(uResetType){
        case RESET_NONE:
        return;

        default:
        case RESET_CENTER:
        d = 1. - step(0.1, length(fragUV - 0.5));
        fragColor = vec4(0, 0, 0, 5.*d);
        return;

        case RESET_CORNER:
        d = 1. - step(2., length(fragXY));
        fragColor = vec4(1, 1, 0, 5.*d);
        return;
    }
}