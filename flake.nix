{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      rust-overlay,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };
        rustToolchain = pkgs.rust-bin.stable.latest.default;
      in
      {
        packages.sondera-opencode-adapter = pkgs.rustPlatform.buildRustPackage rec {
          pname = "sondera-opencode-adapter";
          version = "0.1.0";

          src = ./adapter;
          cargoLock.lockFile = ./adapter/Cargo.lock;

          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.openssl ];

          OPENSSL_DIR = "${pkgs.openssl.dev}";
          OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
          OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";

          meta = with pkgs.lib; {
            description = "Sondera Cedar policy adapter binary for opencode";
            license = licenses.mit;
          };
        };

        packages.default = self.packages.${system}.sondera-opencode-adapter;

        devShells.default = pkgs.mkShell {
          name = "opencode-sondera";

          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.openssl ];

          packages = [
            rustToolchain
            pkgs.cargo-clippy
            pkgs.rustfmt
            pkgs.nodejs
            pkgs.bun
            pkgs.nixfmt-rfc-style
          ];

          env = {
            OPENSSL_DIR = "${pkgs.openssl.dev}";
            OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
            OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
          };
        };
      }
    );
}
