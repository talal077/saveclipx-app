import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFetchXVideo } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

type DownloadState = "idle" | "downloading" | "done" | "error";

export default function DownloaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadStates, setDownloadStates] = useState<
    Record<string, DownloadState>
  >({});
  const inputRef = useRef<TextInput>(null);

  const {
    mutate: fetchVideo,
    data: videoData,
    isPending,
    error,
    reset,
  } = useFetchXVideo();

  const handleFetch = () => {
    if (!url.trim() || isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDownloadStates({});
    fetchVideo({ data: { url: url.trim() } });
  };

  const handleClear = () => {
    setUrl("");
    reset();
    setDownloadStates({});
    inputRef.current?.focus();
  };

  const handleUrlChange = (text: string) => {
    setUrl(text);
    if (videoData || error) {
      reset();
      setDownloadStates({});
    }
  };

  /**
   * Download flow:
   * - Web:   POST /api/download → receive ArrayBuffer → Blob → anchor click
   *          The raw CDN URL never touches the browser. No m3u8 downloads.
   * - Native: GET /api/download?url=...&formatId=...
   *           Backend yt-dlp+ffmpeg produces the MP4, browser downloads it.
   */
  const handleDownload = async (formatId: string, quality: string) => {
    if (downloadingId) return; // prevent concurrent downloads
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setDownloadingId(formatId);
    setDownloadStates((prev) => ({ ...prev, [formatId]: "downloading" }));

    const apiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

    try {
      if (Platform.OS === "web") {
        // --- Web: POST → blob → anchor download ---
        const response = await fetch(`${apiBase}/api/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), formatId }),
        });

        if (!response.ok) {
          let errMsg = "تعذر تحميل الفيديو";
          try {
            const json = (await response.json()) as { error?: string };
            if (json.error) errMsg = json.error;
          } catch {
            // ignore
          }
          throw new Error(errMsg);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `x-video-${quality}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } else {
        // --- Native: GET endpoint → browser handles Content-Disposition ---
        const params = new URLSearchParams({
          url: url.trim(),
          formatId,
        });
        await Linking.openURL(`${apiBase}/api/download?${params.toString()}`);
      }

      setDownloadStates((prev) => ({ ...prev, [formatId]: "done" }));
    } catch (err) {
      setDownloadStates((prev) => ({ ...prev, [formatId]: "error" }));
    } finally {
      setDownloadingId(null);
    }
  };

  const fetchErrorMsg =
    error instanceof Error
      ? error.message
      : error
        ? "تعذر استخراج الفيديو. حاول مرة أخرى."
        : null;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles(colors).scrollContent,
          { paddingTop: topPad + 16, paddingBottom: bottomPad + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles(colors).header}>
          <View style={styles(colors).logoRow}>
            <View style={styles(colors).xBadge}>
              <Text style={styles(colors).xText}>𝕏</Text>
            </View>
            <View>
              <Text style={styles(colors).appTitle}>Video Downloader</Text>
              <Text style={styles(colors).appSubtitle}>
                Save X/Twitter videos instantly
              </Text>
            </View>
          </View>
        </View>

        {/* Input Card */}
        <View style={styles(colors).inputCard}>
          <View style={styles(colors).inputRow}>
            <Feather
              name="link-2"
              size={18}
              color={colors.mutedForeground}
              style={{ marginRight: 10 }}
            />
            <TextInput
              ref={inputRef}
              style={styles(colors).input}
              value={url}
              onChangeText={handleUrlChange}
              placeholder="Paste X/Twitter post URL..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleFetch}
              editable={!isPending}
              selectionColor={colors.primary}
            />
            {url.length > 0 && (
              <TouchableOpacity onPress={handleClear} hitSlop={8}>
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles(colors).fetchBtn,
              (!url.trim() || isPending) && styles(colors).fetchBtnDisabled,
            ]}
            onPress={handleFetch}
            disabled={!url.trim() || isPending}
            activeOpacity={0.85}
          >
            {isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <View style={styles(colors).fetchBtnInner}>
                <Feather
                  name="search"
                  size={17}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles(colors).fetchBtnText}>Fetch Video</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Fetch error */}
        {fetchErrorMsg && (
          <View style={styles(colors).errorCard}>
            <Feather
              name="alert-circle"
              size={18}
              color={colors.destructive}
              style={{ marginRight: 10, marginTop: 1 }}
            />
            <Text style={styles(colors).errorText}>{fetchErrorMsg}</Text>
          </View>
        )}

        {/* Loading skeleton */}
        {isPending && (
          <View style={styles(colors).skeletonCard}>
            <View style={styles(colors).skeletonThumb} />
            <View style={{ padding: 16, gap: 10 }}>
              <View style={[styles(colors).skeletonLine, { width: "90%" }]} />
              <View style={[styles(colors).skeletonLine, { width: "55%" }]} />
              <View
                style={[
                  styles(colors).skeletonLine,
                  { width: "35%", height: 12 },
                ]}
              />
            </View>
          </View>
        )}

        {/* Video result */}
        {videoData && !isPending && (
          <View style={styles(colors).videoCard}>
            {videoData.thumbnail ? (
              <Image
                source={{ uri: videoData.thumbnail }}
                style={styles(colors).thumbnail}
                contentFit="cover"
              />
            ) : (
              <View style={styles(colors).thumbnailPlaceholder}>
                <Feather
                  name="video"
                  size={36}
                  color={colors.mutedForeground}
                />
              </View>
            )}

            <View style={styles(colors).videoMeta}>
              <Text style={styles(colors).videoTitle} numberOfLines={3}>
                {videoData.title}
              </Text>
              <View style={styles(colors).metaRow}>
                {videoData.uploader && (
                  <View style={styles(colors).metaChip}>
                    <Feather
                      name="user"
                      size={12}
                      color={colors.primary}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles(colors).metaText}>
                      @{videoData.uploader}
                    </Text>
                  </View>
                )}
                {videoData.duration && (
                  <View style={styles(colors).metaChip}>
                    <Feather
                      name="clock"
                      size={12}
                      color={colors.mutedForeground}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles(colors).metaText}>
                      {videoData.duration}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Quality / download section */}
            <View style={styles(colors).qualitySection}>
              <Text style={styles(colors).qualityHeader}>
                Select Quality to Download
              </Text>
              {videoData.formats.map((format) => {
                const state = downloadStates[format.formatId] ?? "idle";
                const isThis = downloadingId === format.formatId;

                return (
                  <TouchableOpacity
                    key={format.formatId}
                    style={[
                      styles(colors).qualityRow,
                      state === "done" && styles(colors).qualityRowDone,
                      state === "error" && styles(colors).qualityRowError,
                    ]}
                    onPress={() =>
                      handleDownload(format.formatId, format.quality)
                    }
                    disabled={!!downloadingId}
                    activeOpacity={0.7}
                  >
                    <View style={styles(colors).qualityBadge}>
                      <Text style={styles(colors).qualityBadgeText}>
                        {format.quality}
                      </Text>
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles(colors).qualityExt}>
                        {format.ext.toUpperCase()}
                      </Text>
                      {format.filesize && (
                        <Text style={styles(colors).qualitySize}>
                          {format.filesize}
                        </Text>
                      )}
                      {state === "error" && (
                        <Text style={styles(colors).qualityErrorText}>
                          تعذر التحميل
                        </Text>
                      )}
                    </View>

                    <View
                      style={[
                        styles(colors).dlButton,
                        state === "done" && styles(colors).dlButtonDone,
                        state === "error" && styles(colors).dlButtonError,
                      ]}
                    >
                      {isThis ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : state === "done" ? (
                        <>
                          <Feather name="check" size={14} color="#22c55e" />
                          <Text style={styles(colors).dlButtonTextDone}>
                            Done
                          </Text>
                        </>
                      ) : state === "error" ? (
                        <>
                          <Feather
                            name="alert-circle"
                            size={14}
                            color={colors.destructive}
                          />
                          <Text style={styles(colors).dlButtonTextError}>
                            Retry
                          </Text>
                        </>
                      ) : (
                        <>
                          <Feather
                            name="download"
                            size={14}
                            color={colors.primary}
                          />
                          <Text style={styles(colors).dlButtonText}>
                            Download
                          </Text>
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Empty state */}
        {!videoData && !isPending && !fetchErrorMsg && (
          <View style={styles(colors).emptyState}>
            <View style={styles(colors).emptyIconWrap}>
              <Feather
                name="download-cloud"
                size={40}
                color={colors.primary}
              />
            </View>
            <Text style={styles(colors).emptyTitle}>
              Paste a post URL to get started
            </Text>
            <Text style={styles(colors).emptySubtitle}>
              Works with any public X or Twitter video
            </Text>
            <View style={styles(colors).featureList}>
              {[
                "Real MP4 download — no m3u8",
                "All qualities in one tap",
                "No redirect to video.twimg.com",
              ].map((item) => (
                <View key={item} style={styles(colors).featureRow}>
                  <Feather
                    name="check-circle"
                    size={14}
                    color={colors.primary}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles(colors).featureText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = (
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>,
) =>
  StyleSheet.create({
    scrollContent: {
      paddingHorizontal: 20,
      gap: 16,
    },
    header: {
      marginBottom: 4,
    },
    logoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    xBadge: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: colors.foreground,
      alignItems: "center",
      justifyContent: "center",
    },
    xText: {
      fontSize: 24,
      color: colors.background,
      fontFamily: "Inter_700Bold",
    },
    appTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      letterSpacing: -0.5,
    },
    appSubtitle: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    inputCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    input: {
      flex: 1,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      paddingVertical: 0,
    },
    fetchBtn: {
      backgroundColor: colors.primary,
      marginHorizontal: 12,
      marginBottom: 12,
      borderRadius: 10,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    fetchBtnDisabled: {
      opacity: 0.45,
    },
    fetchBtnInner: {
      flexDirection: "row",
      alignItems: "center",
    },
    fetchBtnText: {
      color: "#fff",
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
    },
    errorCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: `${colors.destructive}15`,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: `${colors.destructive}40`,
      padding: 14,
    },
    errorText: {
      flex: 1,
      color: colors.destructive,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      lineHeight: 20,
    },
    skeletonCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    skeletonThumb: {
      width: "100%",
      height: 190,
      backgroundColor: colors.muted,
    },
    skeletonLine: {
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.muted,
    },
    videoCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    thumbnail: {
      width: "100%",
      height: 200,
      backgroundColor: colors.muted,
    },
    thumbnailPlaceholder: {
      width: "100%",
      height: 160,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    videoMeta: {
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    videoTitle: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      lineHeight: 22,
      marginBottom: 10,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    metaText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    qualitySection: {
      padding: 16,
      gap: 10,
    },
    qualityHeader: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 4,
    },
    qualityRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    qualityRowDone: {
      borderColor: "#22c55e40",
      backgroundColor: "#22c55e08",
    },
    qualityRowError: {
      borderColor: `${colors.destructive}40`,
      backgroundColor: `${colors.destructive}08`,
    },
    qualityBadge: {
      backgroundColor: `${colors.primary}20`,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      minWidth: 60,
      alignItems: "center",
    },
    qualityBadgeText: {
      fontSize: 13,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    qualityExt: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    qualitySize: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    qualityErrorText: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.destructive,
      marginTop: 2,
    },
    dlButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 7,
      minWidth: 90,
      justifyContent: "center",
    },
    dlButtonDone: {
      borderColor: "#22c55e60",
    },
    dlButtonError: {
      borderColor: `${colors.destructive}60`,
    },
    dlButtonText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
    dlButtonTextDone: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: "#22c55e",
    },
    dlButtonTextError: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.destructive,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 50,
      gap: 12,
    },
    emptyIconWrap: {
      width: 80,
      height: 80,
      borderRadius: 24,
      backgroundColor: `${colors.primary}15`,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: {
      fontSize: 17,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    featureList: {
      marginTop: 8,
      gap: 8,
      alignSelf: "stretch",
      paddingHorizontal: 24,
    },
    featureRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    featureText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
  });
