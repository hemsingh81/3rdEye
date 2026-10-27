namespace ThirdEyeAgent;

// STORY-13: one small piece of point-in-circle math, written once here and
// once in the Android agent's own language — not shared code (different
// repos/languages), but the same formula, so the two platforms can't
// silently disagree on an edge case (a point exactly on the boundary).
public static class GeofenceMath
{
    private const double EarthRadiusMeters = 6_371_000;

    public static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
    {
        var dLat = ToRadians(lat2 - lat1);
        var dLon = ToRadians(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                + Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2))
                * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        return EarthRadiusMeters * c;
    }

    public static bool IsInside(double lat, double lon, GeofenceRule rule) =>
        DistanceMeters(lat, lon, rule.Lat, rule.Lon) <= rule.RadiusMeters;

    private static double ToRadians(double degrees) => degrees * Math.PI / 180;
}
