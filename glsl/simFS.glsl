#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPreviousFrame;
uniform vec2 uResolution;
uniform float uDeltaTime;
in vec2 fragUV;

out vec4 fragColor;


void main(void){
    // fragUV is a vec2 with both components from [0, 1]. Multiplying it by our resolution will make each fragment's
    //  value for fragXY an integer which can be a helpful abstraction
    vec2 fragXY = fragUV * uResolution;

    // TODO: use a separate mechanism for initialization (either separate shader, a reset uniform, or just do it in JS)
    //  b/c it's possible to have a 0 velocity in the simulation and we don't want to reset just one cell!
    fragColor = texture(uPreviousFrame, fragUV);
    if (fragColor.xyz == vec3(0, 0, 0)) {
        // This is the first frame, draw something fun
        fragColor = vec4(1, 0, 0, length(fragUV / 1.5)); // Division by 1.5 forces alpha to [0, 1]
        return;
    }

    // texture's second argument is a vec2 with both components from [0, 1]. We can use fragXY and uResolution so that our
    //  offsets still look like integers, though.
    fragColor = texture(uPreviousFrame, (fragXY + vec2(1, 0))/uResolution);

    // TODO: Take in velocities + densities and output next values
}