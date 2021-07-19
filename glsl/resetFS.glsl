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
const int RESET_SPIRAL_IN = 3;


/** void main(void)
DESCRIPTION: The main function of the fragment shader. Resets the canvas with hard-coded output.
INPUTS:      None
OUTPUTS:     Sets the value of fragColor, the output color of this fragment
*/
void main(void){
    vec2 fragXY = fragUV * uResolution - 0.5;

    vec2 aspect = normalize(uResolution);
    vec2 uv = fragUV * aspect; // Aspect ratio-corrected UVs (not always in [0, 1])

    float d = 0.;
    vec2 v = vec2(0);

    switch(uResetType){
        case RESET_NONE:
        return;

        default:
        case RESET_CENTER:
        d = 5. * (1. - step(0.1, length((fragUV - 0.5) * aspect)));
        fragColor = vec4(v, 0, d);
        return;

        case RESET_CORNER:
        d = 5. * (1. - step(0.1, length((fragUV - 0.15) * aspect)));
        v = uResolution * vec2(0.0625, 0.1) * (1. - step(0.25, abs(uv.x - uv.y)));
        fragColor = vec4(v, 0, d);
        return;

        case RESET_SPIRAL_IN:
        vec2 p = (fragUV - 0.5) * uResolution; // resolution corrected but with center origin
        d = 1. - step(0.25, length(uv));
        v.x = p.y - p.x;
        v.y = -p.x - p.y;
        v = uResolution * vec2(0.0625, 0.1) * normalize(v);
        fragColor = vec4(v, 0, d);
        return;
    }
}