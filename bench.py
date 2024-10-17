import multiprocessing
import subprocess
import sys
import re
import os.path

BENCH_VARIANTS = [
    ("border-geometric no-rng-tris-remove", ""),
    ("border-geometric", "-rngTrisRemove"),
    ("", "-rngTrisRemove-meshletBorder"),
    ("32", "-rngTrisRemove-meshletBorder-32"),
    ("decimate-round-to-meshlet", "-rngTrisRemove-meshletBorder-roundUpTrisTo128"),
    (
        "decimate-round-to-meshlet 32",
        "-rngTrisRemove-meshletBorder-roundUpTrisTo128-32",
    ),
]

BENCH_FILES = {
    "jinx": "jinx-combined.obj",
    "robot": "robot.obj",
    "bunny": "bunny.obj",
}


# $(DENO) task start robot.obj decimate-round-to-meshlet 32 > "-rngTrisRemove-meshletBorder-roundUpTrisTo128-32"


def get_deno_path():
    pattern = re.compile(r"DENO\W*=\W*\"(.*?)\"")
    with open("makefile", "r") as f:
        s = f.readline()
        match = pattern.match(s)
        if match:
            return match.groups()[0]
    raise "Could not read DENO path from makefile"


DENO = get_deno_path()


def process_variant(arg):
    model, variant = arg
    cmd_args, suffix = variant
    # print(model, cmd_args, suffix)

    fileName = BENCH_FILES[model]  # "jinx-combined.obj"
    out_file_path = os.path.join("logs", f"{model}{suffix}.txt")

    cmd = [DENO, "task", "start", fileName]
    if len(cmd_args) > 0:
        cmd.extend(cmd_args.split(" "))
    # print(cmd, "\n\t", out_file_path)

    with open(out_file_path, "w") as log_file:
        ret_code = subprocess.call(cmd, stdout=log_file, stderr=subprocess.STDOUT)
        return cmd, out_file_path, ret_code


if __name__ == "__main__":
    print(sys.argv)
    model = sys.argv[1] if len(sys.argv) > 1 else "<no model provided>"
    if model not in BENCH_FILES.keys():
        models = [f"'{x}'" for x in BENCH_FILES.keys()]
        raise Exception(
            f"Invalid model '{model}', expected one of: {', '.join(models)}"
        )
    print(f"Model: '{model}'")

    with multiprocessing.Pool() as pool:
        variant_args = [(model, x) for x in BENCH_VARIANTS]
        result = pool.map_async(process_variant, variant_args, chunksize=1)
        result.wait()

        for result in result.get():
            cmd, out_file_path, ret_code = result
            if ret_code != 0:
                msg = f"Error code {ret_code} for '{cmd}'\n\tSee '{out_file_path}' for details"
                print("----------------------------------")
                print(msg)
                with open(out_file_path, "r") as log_file:
                    print(log_file.read())
                print(msg)
                print("----------------------------------")
            else:
                print(f"Created '{out_file_path}'")
