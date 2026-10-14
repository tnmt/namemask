{
  lib,
  stdenvNoCC,
  makeWrapper,
  nodejs,
  yq-go,
}:

stdenvNoCC.mkDerivation {
  pname = "namemask";
  version = (lib.importJSON ../package.json).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bin
      ../src
      ../test
    ];
  };

  nativeBuildInputs = [ makeWrapper ];
  nativeCheckInputs = [
    nodejs
    yq-go
  ];

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test 'test/*.test.js'
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/node_modules/namemask $out/bin
    cp -r package.json bin src $out/lib/node_modules/namemask/
    makeWrapper ${lib.getExe nodejs} $out/bin/namemask \
      --add-flags $out/lib/node_modules/namemask/bin/namemask.js \
      --prefix PATH : ${lib.makeBinPath [ yq-go ]}
    runHook postInstall
  '';

  meta = {
    description = "Replace known personal names with role tokens in text and file trees";
    homepage = "https://github.com/tnmt/namemask";
    license = lib.licenses.mit;
    mainProgram = "namemask";
    platforms = lib.platforms.all;
  };
}
