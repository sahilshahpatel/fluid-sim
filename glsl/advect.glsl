#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Advection is the process by which a quantity moves along a velocity field. This is used for all qualities of the fluid
// including the dye density and also the velocity itself. You would typically want to move a cell's quantities along 
// its own velocity, but in a fragment-based system like this that does not work when the velocity vector doesn't point 
// exactly into another cell. Instead we assume some continuity of the field and we go backwards, so a cell's next values
// come from the location which would have travelled to this cell if it had our velocity last frame. We do a bilinear
// interpolation when the velocity vector doesn't point directly to a cell center. 
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;             // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 xNext;             // The advected quantity for this cell

uniform sampler2D x;        // Quantity to advect
uniform sampler2D vel;      // Velocity field
uniform float dt;           // Time passed since last frame
uniform vec2 res;           // Texture resolution


void main(){
    // Get our previous velocity and trace it back in time
    vec2 v = texture(vel, fragUV).xy / res;
    vec2 source = fragUV - v * dt;
    
    xNext = texture(x, source);
}