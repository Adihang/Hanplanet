#!/usr/bin/env bash
set -euo pipefail

readonly APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SERVER_DIR="${DECEASEDCRAFT_SERVER_DIR:-/Users/imhanbyeol/Development/deceasedcraft}"
readonly SOURCE_ARCHIVE="${MORU_RESOURCE_PACK_ARCHIVE:-/Volumes/HANPLANET_HDD/Hanplanet/minecraft-updates/deceasedcraft/moru-2d3b2bc6/resource_pack-20260816.zip}"
readonly OUTPUT_DIR="${DECEASEDCRAFT_RESOURCE_PACK_OUTPUT_DIR:-/Volumes/HANPLANET_HDD/Hanplanet/minecraft-updates/deceasedcraft/moru-2d3b2bc6}"
readonly PUBLIC_OUTPUT="${APP_DIR}/static/media/minecraft/deceasedcraft/DeceasedCraft-5.10.17-ko_kr-clean-resource_pack.zip"
readonly WORK_DIR="$(mktemp -d /tmp/deceasedcraft-korean-pack.XXXXXX)"
readonly RESOURCE_ROOT="${WORK_DIR}/resource"
readonly BAD_CHAR=$'\xEF\xBF\xBD'

mkdir -p "${OUTPUT_DIR}" "$(dirname "${PUBLIC_OUTPUT}")"
unzip -q "${SOURCE_ARCHIVE}" -d "${RESOURCE_ROOT}"

removed_language_entries=0
removed_patchouli_files=0

# Remove damaged language values while preserving every valid translation.
while IFS= read -r -d '' lang_file; do
    cleaned_file="${lang_file}.cleaned"
    removed_count="$(jq '[to_entries[] | select((.value | type) == "string" and (.value | contains("\ufffd")))] | length' "${lang_file}")"
    jq 'if type == "object" then with_entries(select((.value | type) != "string" or ((.value | contains("\ufffd")) | not))) else . end' "${lang_file}" > "${cleaned_file}"
    mv "${cleaned_file}" "${lang_file}"
    removed_language_entries=$((removed_language_entries + removed_count))
    if [ "$(jq 'if type == "object" then length else 1 end' "${lang_file}")" -eq 0 ]; then
        rm "${lang_file}"
    fi
done < <(find "${RESOURCE_ROOT}/assets" -type f -path '*/lang/ko_kr.json' -print0)

# A damaged Patchouli book should fall back to its original English book rather than
# displaying broken Korean text. Valid Patchouli translations remain in the pack.
while IFS= read -r -d '' book_file; do
    if grep -q "${BAD_CHAR}" "${book_file}"; then
        rm "${book_file}"
        removed_patchouli_files=$((removed_patchouli_files + 1))
    fi
done < <(find "${RESOURCE_ROOT}/assets" -type f -path '*/ko_kr/*.json' -print0)

# Fill missing entries with clean Korean files shipped inside the installed mods.
while IFS= read -r -d '' mod_jar; do
    while IFS= read -r lang_entry; do
        [ -n "${lang_entry}" ] || continue
        target_file="${RESOURCE_ROOT}/${lang_entry}"
        jar_file="${WORK_DIR}/jar-lang.json"
        clean_jar_file="${WORK_DIR}/jar-lang-clean.json"
        unzip -p "${mod_jar}" "${lang_entry}" > "${jar_file}"
        if ! jq -e . "${jar_file}" >/dev/null 2>&1; then
            continue
        fi
        jq 'if type == "object" then with_entries(select((.value | type) != "string" or ((.value | contains("\ufffd")) | not))) else . end' "${jar_file}" > "${clean_jar_file}"
        mkdir -p "$(dirname "${target_file}")"
        if [ -f "${target_file}" ]; then
            # Prefer the Moru translation when it is valid; use the mod's clean
            # built-in translation only for keys removed from the Moru file.
            jq -s '.[0] * .[1]' "${clean_jar_file}" "${target_file}" > "${target_file}.merged"
            mv "${target_file}.merged" "${target_file}"
        else
            cp "${clean_jar_file}" "${target_file}"
        fi
    done < <(unzip -Z1 "${mod_jar}" | rg '^assets/.+/lang/ko_kr\.json$' || true)
done < <(find "${SERVER_DIR}/mods" -maxdepth 1 -type f -name '*.jar' -print0 | sort -z)

if rg -l -a "${BAD_CHAR}" "${RESOURCE_ROOT}/assets" >/dev/null 2>&1; then
    echo "The generated resource pack still contains replacement characters." >&2
    rg -l -a "${BAD_CHAR}" "${RESOURCE_ROOT}/assets" >&2
    exit 1
fi

jq '.pack.description = "DeceasedCraft 5.10.17 Korean resource pack (cleaned)"' \
    "${RESOURCE_ROOT}/pack.mcmeta" > "${RESOURCE_ROOT}/pack.mcmeta.cleaned"
mv "${RESOURCE_ROOT}/pack.mcmeta.cleaned" "${RESOURCE_ROOT}/pack.mcmeta"

readonly OUTPUT_ARCHIVE="${OUTPUT_DIR}/DeceasedCraft-5.10.17-ko_kr-clean-resource_pack.zip"
(
    cd "${RESOURCE_ROOT}"
    zip -q -X -r "${OUTPUT_ARCHIVE}" .
)
cp "${OUTPUT_ARCHIVE}" "${PUBLIC_OUTPUT}"
unzip -t "${OUTPUT_ARCHIVE}" >/dev/null

printf 'output=%s\n' "${OUTPUT_ARCHIVE}"
printf 'public_output=%s\n' "${PUBLIC_OUTPUT}"
printf 'removed_language_entries=%s\n' "${removed_language_entries}"
printf 'removed_patchouli_files=%s\n' "${removed_patchouli_files}"
printf 'sha256=%s\n' "$(shasum -a 256 "${OUTPUT_ARCHIVE}" | awk '{print $1}')"
printf 'sha1=%s\n' "$(shasum -a 1 "${OUTPUT_ARCHIVE}" | awk '{print $1}')"
