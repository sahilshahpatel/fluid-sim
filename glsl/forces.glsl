#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// This shader adds in all external forces on our fluid. This could include both user input and other forces like
// vorticity confinement. To do this we modify the fluid's velocity field.
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;                 // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 velNext;               // The updated velocity for this cell

uniform sampler2D vel;          // Velocity field
uniform float dt;               // Time passed since last frame
uniform vec2 res;               // Texture resolution

uniform float userForceRad;     // Radius for user input force
uniform vec2 userForcePos;      // Position for user input force
uniform vec2 userForceStrength; // Force magnitude for user input force


void main(){
    vec2 fragXY = fragUV * res - 0.5;

    // We are adding to whatever already exists
    vec2 lastVel = texture(vel, fragUV).xy;

    // User input force
    vec2 sourceDist = fragXY - userForcePos;
    vec2 userForce = userForceStrength * exp(-dot(sourceDist, sourceDist) / userForceRad) * dt;

    // TODO: Add vorticity confinement (requires more uniforms)
    vec2 vortForce = vec2(0);

    velNext = vec4(lastVel + userForce + vortForce, 0., 0.);
}