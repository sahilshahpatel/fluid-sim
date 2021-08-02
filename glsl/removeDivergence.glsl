#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Removes the divergence of a vector field given calculated pressure values. For our purposes, this vector field will
// always be the velocity field.
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;                 // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 velNext;               // The updated velocity for this cell

uniform sampler2D vel;          // The velocity vector field
uniform sampler2D p;            // THe pressure field
uniform vec2 res;               // Texture resolution


void main(){
    // Get neighboring cell's pressure data
    float left  = texture(p, fragUV + vec2(-1,  0) / res).x;
    float right = texture(p, fragUV + vec2( 1,  0) / res).x;
    float down  = texture(p, fragUV + vec2( 0, -1) / res).x;
    float up    = texture(p, fragUV + vec2( 0,  1) / res).x;

    // Calculate pressure gradient
    vec2 grad = vec2(right - left, up - down) * 0.5;

    // Get our previous velocity and subtract out the gradient
    vec2 v = texture(vel, fragUV).xy;
    velNext = vec4(v - grad, 0., 0.);
}