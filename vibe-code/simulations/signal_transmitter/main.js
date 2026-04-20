document.addEventListener('DOMContentLoaded', function() {
    var sceneCanvas = document.getElementById('sceneCanvas');
    var scene = new SceneRenderer(sceneCanvas);
    var engine = new TransmissionEngine();
    var ui = setupUI(scene, engine);

    // Cropper operates directly on the source canvas
    var cropper = new ImageCropper(
        document.getElementById('sourceCanvas'),
        function onCropped(imageData) {
            ui.onImageCropped(imageData);
        }
    );
    window._cropper = cropper;

    // Scene animation loop
    var lastTime = 0;
    function loop(timestamp) {
        var dt = timestamp - lastTime;
        lastTime = timestamp;
        if (dt > 100) dt = 16;
        scene.draw(dt);
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
});
