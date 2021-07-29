#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Renders a visualization to screen based on fluid simulation data.
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;             // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 fragColor;         // The output color cell

uniform sampler2D dye;      // Dye density data
uniform sampler2D vel;      // Velocity data
uniform vec2 dataRes;       // Texture resolution


void main(){
    float d = texture(dye, fragUV).x;
    vec2  v = texture(vel, fragUV).xy;

    fragColor = vec4(d, v.x, v.y, 1.);
}