#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Enforces the boundary conditions on the input texture. This shader should be run only for the boundary cells with
// different uniform values for each boundary.
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;             // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 nextX;             // The updated value for this cell

uniform sampler2D x;        // The input data field
uniform vec2 res;           // Texture resolution
uniform vec2 offset;        // Identifies the offset into the neighboring (non-boundary) cell
uniform float coeff;         // Coefficient modifying the data from the neighbor


void main(){
    vec4 neighbor = texture(x, fragUV + offset / res);
    nextX = coeff * neighbor;
}