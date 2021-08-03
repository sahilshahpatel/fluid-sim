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

in vec2 fragUV;                  // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 velNext;                // The updated velocity for this cell

uniform sampler2D vel;           // Velocity field
uniform sampler2D curl;          // Curl of velocity field
uniform float dt;                // Time passed since last frame
uniform vec2 res;                // Texture resolution

uniform float userForceRad;      // Radius for user input force
uniform vec2 userForcePos;       // Position for user input force
uniform vec2 userForceStrength;  // Force magnitude for user input force
uniform float vorticityStrength; // Strength of vorticty confinement force


void main(){
    vec2 fragXY = fragUV * res - 0.5;

    // We are adding to whatever already exists
    vec2 lastVel = texture(vel, fragUV).xy;

    // User input force
    vec2 sourceDist = fragXY - userForcePos;
    vec2 userForce = userForceStrength * exp(-dot(sourceDist, sourceDist) / userForceRad) * dt;

    velNext = vec4(lastVel + userForce, 0., 0.);

    // Vorticity confinement force
    if(vorticityStrength > 0.){
        vec4 left  = texture(curl, fragUV + vec2(-1,  0) / res);
        vec4 right = texture(curl, fragUV + vec2( 1,  0) / res);
        vec4 down  = texture(curl, fragUV + vec2( 0, -1) / res);
        vec4 up    = texture(curl, fragUV + vec2( 0,  1) / res);
        
        vec3 vorticity = vec3(length(right) - length(left), length(up) - length(down), 0.);
        vorticity = length(vorticity) > 0. ? normalize(vorticity) : vec3(0.);
        vec3 myCurl = texture(curl, fragUV).xyz;

        vec2 vortForce = vorticityStrength * cross(vorticity, myCurl).xy * dt;
        velNext += vec4(vortForce, 0., 0.);
    }
}