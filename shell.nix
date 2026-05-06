{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  name = "opencode-sondera";

  nativeBuildInputs = with pkgs; [
    pkg-config
  ];

  buildInputs = with pkgs; [
    openssl
    openssl.dev
  ];

  packages = with pkgs; [
    rustc
    cargo
    clippy
    rustfmt
    nodejs
    bun
    nixfmt-rfc-style
  ];

  env = {
    OPENSSL_DIR = "${pkgs.openssl.dev}";
    OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
    OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
  };

  shellHook = ''
    echo "opencode-sondera dev shell"
    echo "  adapter binary: build with  cargo build --release --manifest-path adapter/Cargo.toml"
    echo "  harness server: build with  cargo build --release --bin sondera-harness-server --manifest-path ../sondera-coding-agent-hooks/Cargo.toml"
  '';
}
